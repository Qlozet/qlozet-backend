import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin client for QoreID (https://docs.qoreid.com).
 *
 * Data-minimisation by design: callers get back a compact, storage-safe
 * summary (verdict, provider reference, verified name, masked id) — never
 * the raw identity payload. The full report stays retrievable in the QoreID
 * dashboard via provider_ref.
 */

export interface QoreIdVerdict {
  verified: boolean;
  /** QoreID's id for this verification — the audit trail pointer. */
  provider_ref: string | null;
  /** Name as returned by the authoritative source (NIMC, bank, CAC). */
  verified_name: string | null;
  /** e.g. EXACT_MATCH | PARTIAL_MATCH | NO_MATCH, when QoreID returns one. */
  match: string | null;
  /** Raw status words, for support/debugging ("verified", "not_verified"…). */
  status: string | null;
}

// Endpoint paths per product (kept in one place — QoreID versions these
// individually, so a doc change is a one-line fix here).
const ENDPOINTS = {
  token: '/token',
  vnin: (vnin: string) => `/v1/ng/identities/vnin/${vnin}`,
  nuban: (account: string) => `/v1/ng/identities/nuban/${account}`,
  cacBasic: '/v2/ng/identities/cac-basic',
};

@Injectable()
export class QoreIdService {
  private readonly logger = new Logger(QoreIdService.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (
      this.config.get<string>('QOREID_BASE_URL') || 'https://api.qoreid.com'
    );
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('QOREID_CLIENT_ID') &&
        this.config.get<string>('QOREID_SECRET'),
    );
  }

  /** OAuth token, cached until shortly before expiry. */
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.value;
    }
    const clientId = this.config.get<string>('QOREID_CLIENT_ID');
    const secret = this.config.get<string>('QOREID_SECRET');
    if (!clientId || !secret) {
      throw new ServiceUnavailableException(
        'Identity verification is not configured yet.',
      );
    }
    const res = await fetch(`${this.baseUrl}${ENDPOINTS.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, secret }),
    });
    if (!res.ok) {
      this.logger.error(`QoreID token request failed: ${res.status}`);
      throw new ServiceUnavailableException(
        'Verification service is unavailable right now — try again shortly.',
      );
    }
    const body: any = await res.json();
    const accessToken = body?.accessToken;
    if (!accessToken) {
      throw new ServiceUnavailableException(
        'Verification service is unavailable right now — try again shortly.',
      );
    }
    const ttlSeconds = Number(body?.expiresIn) || 3600;
    this.token = {
      value: accessToken,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    return accessToken;
  }

  private async post(path: string, payload: Record<string, any>) {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Token may have been revoked server-side — drop the cache so the
      // next call re-authenticates.
      this.token = null;
    }
    if (!res.ok) {
      const message =
        body?.message || body?.error || `Verification failed (${res.status})`;
      // 4xx = the caller's input (wrong vNIN, bad RC number) — surface it.
      if (res.status >= 400 && res.status < 500) {
        throw new BadRequestException(
          Array.isArray(message) ? message[0] : message,
        );
      }
      this.logger.error(
        `QoreID ${path} failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`,
      );
      throw new ServiceUnavailableException(
        'Verification service is unavailable right now — try again shortly.',
      );
    }
    return body;
  }

  /** Collapse a QoreID response into the compact verdict we persist. */
  private toVerdict(body: any, verifiedName: string | null): QoreIdVerdict {
    const statusWord: string | null =
      body?.status?.status ?? body?.status?.state ?? null;
    const match: string | null =
      body?.summary && typeof body.summary === 'object'
        ? ((Object.values(body.summary)[0] as any)?.status ?? null)
        : null;
    const verified =
      typeof statusWord === 'string' &&
      ['verified', 'id_verified', 'complete'].includes(
        statusWord.toLowerCase(),
      ) &&
      match !== 'NO_MATCH';
    return {
      verified,
      provider_ref: body?.id != null ? String(body.id) : null,
      verified_name: verifiedName,
      match,
      status: statusWord,
    };
  }

  /**
   * vNIN identity check. The vendor generates their virtual NIN via the
   * NIMC app / *346# and we match it against their name — the vNIN itself
   * is short-lived and is never stored.
   */
  async verifyVnin(
    vnin: string,
    firstname: string,
    lastname: string,
  ): Promise<QoreIdVerdict> {
    const body = await this.post(ENDPOINTS.vnin(vnin.trim()), {
      firstname,
      lastname,
    });
    const person = body?.vnin ?? body?.nin ?? {};
    const name =
      [person?.firstname, person?.lastname].filter(Boolean).join(' ') || null;
    return this.toVerdict(body, name);
  }

  /** NUBAN (regular): resolves the account and matches the holder's name. */
  async verifyNuban(
    accountNumber: string,
    bankCode: string,
    firstname: string,
    lastname: string,
  ): Promise<QoreIdVerdict & { account_name: string | null }> {
    const body = await this.post(ENDPOINTS.nuban(accountNumber.trim()), {
      firstname,
      lastname,
      bankCode,
    });
    const account = body?.nuban ?? {};
    const accountName: string | null =
      account?.accountName ??
      [account?.firstName, account?.lastName].filter(Boolean).join(' ') ??
      null;
    const verdict = this.toVerdict(body, accountName);
    return { ...verdict, account_name: accountName };
  }

  /** CAC Basic v2: confirms the RC number and returns the registered name. */
  async verifyCacBasic(
    regNumber: string,
  ): Promise<QoreIdVerdict & { company_name: string | null }> {
    const body = await this.post(ENDPOINTS.cacBasic, {
      regNumber: regNumber.trim(),
    });
    const cac = body?.cac_basic ?? body?.cac ?? {};
    const companyName: string | null =
      cac?.companyName ?? cac?.company_name ?? null;
    const verdict = this.toVerdict(body, companyName);
    return { ...verdict, company_name: companyName };
  }
}
