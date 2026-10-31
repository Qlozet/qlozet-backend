import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

const FLW_BASE = 'https://api.flutterwave.com/v3';
const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

export interface FlutterwaveCharge {
  /** Our ledger reference (Flutterwave's tx_ref). */
  reference: string;
  /** successful | failed | pending | not_found */
  status: 'successful' | 'failed' | 'pending' | 'not_found';
  amount?: number;
  currency?: string;
  /** Flutterwave's own transaction id, needed for refunds. */
  id?: number;
  raw?: any;
}

/**
 * Flutterwave v3 API: the second naira rail beside Paystack.
 *
 * Keys come from env (never from the database):
 *   FLW_SECRET_KEY   API calls
 *   FLW_SECRET_HASH  the "secret hash" set on the dashboard webhook page;
 *                    Flutterwave echoes it back so we know a webhook is theirs
 *
 * Amounts are naira (major units), unlike Paystack's kobo.
 */
@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private banksCache: { at: number; banks: { code: string; name: string }[] } | null =
    null;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** True when the secret key is set, so the rail can be used at all. */
  isConfigured(): boolean {
    return !!this.config.get<string>('FLW_SECRET_KEY');
  }

  private headers() {
    const key = this.config.get<string>('FLW_SECRET_KEY');
    if (!key) {
      throw new ServiceUnavailableException('Flutterwave is not configured.');
    }
    return { Authorization: `Bearer ${key}` };
  }

  /** Start a hosted checkout. Returns the page the customer pays on. */
  async initialize(input: {
    reference: string;
    amount: number;
    email: string;
    currency?: string;
    redirectUrl?: string;
  }): Promise<{ link: string }> {
    const payload: Record<string, any> = {
      tx_ref: input.reference,
      amount: Math.round(input.amount * 100) / 100,
      currency: input.currency || 'NGN',
      customer: { email: input.email },
      customizations: { title: 'Qlozet' },
      meta: { reference: input.reference },
    };
    if (input.redirectUrl) payload.redirect_url = input.redirectUrl;

    try {
      const res: any = await firstValueFrom(
        this.http.post(`${FLW_BASE}/payments`, payload, {
          headers: this.headers(),
          timeout: 15000,
        }),
      );
      const link: string | undefined = res?.data?.data?.link;
      if (res?.data?.status !== 'success' || !link) {
        throw new BadGatewayException('Invalid response received from Flutterwave');
      }
      return { link };
    } catch (error: any) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      const msg: string | undefined = error?.response?.data?.message;
      this.logger.error(
        `Flutterwave payment initialization failed: ${msg || error?.message}`,
      );
      throw new BadGatewayException(
        msg ? `Unable to initialize payment: ${msg}` : 'Unable to initialize payment.',
      );
    }
  }

  /** Look up a charge by our reference. Never throws for "not paid yet". */
  async verify(reference: string): Promise<FlutterwaveCharge> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${FLW_BASE}/transactions/verify_by_reference`, {
          params: { tx_ref: reference },
          headers: this.headers(),
          timeout: 15000,
        }),
      );
      const d = res?.data?.data;
      if (!d) return { reference, status: 'not_found', raw: res?.data };
      const s = String(d.status || '').toLowerCase();
      return {
        reference,
        status: s === 'successful' ? 'successful' : s === 'failed' ? 'failed' : 'pending',
        amount: typeof d.amount === 'number' ? d.amount : Number(d.amount),
        currency: d.currency,
        id: d.id,
        raw: d,
      };
    } catch (error: any) {
      // Flutterwave answers 400 "No transaction was found for this id" while the
      // customer has not paid yet. That is not an error for us.
      const msg: string = error?.response?.data?.message ?? '';
      if (error?.response?.status === 400 || error?.response?.status === 404) {
        return { reference, status: 'not_found', raw: msg };
      }
      throw error;
    }
  }

  /** Refund a charge; amount (naira) omitted = full refund. */
  async refund(flwTransactionId: number, amount?: number) {
    const body = amount != null ? { amount: Math.round(amount * 100) / 100 } : {};
    const res: any = await firstValueFrom(
      this.http.post(`${FLW_BASE}/transactions/${flwTransactionId}/refund`, body, {
        headers: this.headers(),
        timeout: 15000,
      }),
    );
    if (res?.data?.status !== 'success') {
      throw new BadRequestException(
        res?.data?.message || 'Flutterwave refund failed',
      );
    }
    return res.data.data;
  }

  /** Nigerian banks as Flutterwave knows them (cached for a day). */
  async listBanks(): Promise<{ code: string; name: string }[]> {
    if (this.banksCache && Date.now() - this.banksCache.at < BANKS_TTL_MS) {
      return this.banksCache.banks;
    }
    const res: any = await firstValueFrom(
      this.http.get(`${FLW_BASE}/banks/NG`, {
        headers: this.headers(),
        timeout: 15000,
      }),
    );
    const banks = (res?.data?.data ?? []).map((b: any) => ({
      code: String(b.code),
      name: String(b.name),
    }));
    this.banksCache = { at: Date.now(), banks };
    return banks;
  }

  /**
   * Vendors saved their bank through Paystack, whose codes match Flutterwave's
   * for the big banks but not for most fintechs (Opay, Kuda, Moniepoint...).
   * Match the code first, then the bank's name.
   */
  async bankCodeFor(paystackCode?: string, bankName?: string): Promise<string> {
    const banks = await this.listBanks();
    if (paystackCode && banks.some((b) => b.code === paystackCode)) {
      return paystackCode;
    }
    const norm = (s: string) =>
      s.toLowerCase().replace(/\b(plc|limited|ltd|bank|mfb|microfinance)\b/g, '').replace(/[^a-z0-9]/g, '');
    const want = bankName ? norm(bankName) : '';
    const hit =
      want &&
      (banks.find((b) => norm(b.name) === want) ??
        banks.find((b) => norm(b.name).startsWith(want) || want.startsWith(norm(b.name))));
    if (!hit) {
      throw new BadRequestException(
        `Could not match the vendor's bank (${bankName || paystackCode}) on Flutterwave.`,
      );
    }
    return hit.code;
  }

  /** Send naira to a Nigerian bank account. Returns Flutterwave's transfer status. */
  async transfer(input: {
    reference: string;
    amount: number;
    bankCode: string;
    accountNumber: string;
    narration: string;
  }): Promise<{ id?: number; status: string }> {
    const res: any = await firstValueFrom(
      this.http.post(
        `${FLW_BASE}/transfers`,
        {
          account_bank: input.bankCode,
          account_number: input.accountNumber,
          amount: Math.round(input.amount * 100) / 100,
          currency: 'NGN',
          debit_currency: 'NGN',
          narration: input.narration.slice(0, 100),
          reference: input.reference,
        },
        { headers: this.headers(), timeout: 20000 },
      ),
    );
    if (res?.data?.status !== 'success' || !res?.data?.data) {
      throw new BadRequestException(res?.data?.message || 'Flutterwave transfer failed');
    }
    return { id: res.data.data.id, status: String(res.data.data.status) };
  }

  /**
   * Is this webhook from Flutterwave? Newer accounts sign the raw body
   * (`flutterwave-signature`: base64 HMAC-SHA256 with the secret hash); older
   * ones echo the secret hash in `verif-hash`. Accept either, compared in
   * constant time.
   */
  isValidWebhook(headers: Record<string, any>, rawBody: Buffer | string): boolean {
    const secret = this.config.get<string>('FLW_SECRET_HASH');
    if (!secret) return false;
    const same = (a: string, b: string) => {
      const x = Buffer.from(a);
      const y = Buffer.from(b);
      return x.length === y.length && crypto.timingSafeEqual(x, y);
    };
    const signature = headers['flutterwave-signature'];
    if (typeof signature === 'string' && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('base64');
      return same(signature, expected);
    }
    const hash = headers['verif-hash'];
    return typeof hash === 'string' && same(hash, secret);
  }
}
