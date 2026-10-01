import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

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
// Confirmed against docs.qoreid.com (reference/vnin-virtual-nin,
// reference/nuban, docs/cac-premium-v2's cac-{tier} pattern).
const ENDPOINTS = {
  token: '/token',
  vnin: (vnin: string) => `/v1/ng/identities/virtual-nin/${vnin}`,
  nuban: '/v1/ng/identities/nuban',
  cacBasic: '/v2/ng/identities/cac-basic',
  // Workflow sessions. Note the auth differs from every endpoint above:
  // docs/sdk-session-tokens specifies HTTP Basic with the same clientId and
  // secret, not the OAuth bearer token the product endpoints use.
  sessions: '/v1/sessions',
};

/** What a minted workflow session hands back. */
export interface WorkflowSession {
  session_id: string;
  /** Short-lived, single-use JWT — the only part the browser may see. */
  sdk_token: string;
  expires_at: string | null;
}

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

  /** The published workflow a vendor is sent through. */
  get workflowId(): number | null {
    const raw = this.config.get<string>('QOREID_WORKFLOW_ID');
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /**
   * Mint a session for the hosted verification flow.
   *
   * The whole workflow — liveness, identity document, CAC, NUBAN, address —
   * runs inside QoreID's SDK against the workflow published in their console,
   * so the document images and the selfie never touch our storage. We hold a
   * session id and, later, the verdicts the webhook reports.
   *
   * `reference` is ours and comes back on the webhook; it is how a result is
   * matched to a business, so it must be unique per attempt.
   */
  async createWorkflowSession(reference: string): Promise<WorkflowSession> {
    const clientId = this.config.get<string>('QOREID_CLIENT_ID');
    const secret = this.config.get<string>('QOREID_SECRET');
    const workflowId = this.workflowId;

    if (!clientId || !secret) {
      throw new ServiceUnavailableException(
        'Identity verification is not configured yet.',
      );
    }
    if (!workflowId) {
      throw new ServiceUnavailableException(
        'No verification workflow is configured (QOREID_WORKFLOW_ID).',
      );
    }

    const res = await fetch(`${this.baseUrl}${ENDPOINTS.sessions}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Basic, not Bearer — see the note on ENDPOINTS.sessions.
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        // Makes a retried request return the same session instead of burning
        // a second paid workflow run.
        'Idempotency-Key': reference,
      },
      body: JSON.stringify({
        type: 'workflow',
        workflowId,
        reference,
      }),
    });

    const body = await res.json().catch(() => ({}) as any);

    if (!res.ok) {
      this.logger.error(
        `QoreID session request failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`,
      );
      throw new ServiceUnavailableException(
        body?.message ||
          'Could not start verification right now. Try again shortly.',
      );
    }

    const token = body?.sdkSessionToken ?? body?.sdk_session_token;
    const sessionId = body?.sessionId ?? body?.session_id;
    if (!token || !sessionId) {
      this.logger.error(
        `QoreID session response missing token/id: ${JSON.stringify(body).slice(0, 300)}`,
      );
      throw new ServiceUnavailableException(
        'Verification could not be started. Support has been notified.',
      );
    }

    return {
      session_id: String(sessionId),
      sdk_token: String(token),
      expires_at: body?.expiresAt ?? body?.expires_at ?? null,
    };
  }

  /**
   * Whether a webhook really came from QoreID.
   *
   * docs/webhook-configuration: the body is hashed with HMAC-SHA512 using the
   * webhook secret and sent as `x-verifyme-signature`. Compared in constant
   * time — a plain === leaks how much of the signature matched, which is
   * enough to forge one given patience.
   *
   * Returns false when no secret is configured. Refusing is the safe default:
   * an unauthenticated endpoint that writes verification verdicts is worth
   * more to an attacker than any amount of convenience is worth to us.
   */
  verifyWebhookSignature(rawBody: string, signature?: string): boolean {
    const secret = this.config.get<string>('QOREID_WEBHOOK_SECRET');
    if (!secret || !signature) return false;

    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature.trim(), 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
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
    const person = body?.v_nin ?? body?.vnin ?? body?.nin ?? {};
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
    const body = await this.post(ENDPOINTS.nuban, {
      firstname,
      lastname,
      accountNumber: accountNumber.trim(),
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
    const cac = body?.cac_basic ?? body?.cac ?? body ?? {};
    const companyName: string | null =
      cac?.companyName ?? cac?.company_name ?? body?.companyName ?? null;
    const verdict = this.toVerdict(body, companyName);
    return { ...verdict, company_name: companyName };
  }
}
