// ─── Payment provider abstraction (multi-currency plan, Phase 1) ──────────
//
// Charging and payouts go through these interfaces so processors are swappable
// and routable by currency/entity:
//   NGN  → Paystack   (Qlozet Nigeria entity)
//   else → Stripe     (Qlozet, Inc. US entity — Phase 3)
//
// See docs/multi-currency-payments-plan.md.

export type Processor = 'paystack' | 'stripe';
export type SettlementEntity = 'ng' | 'us';

/** Which entity a processor's money lands in. */
export const PROCESSOR_ENTITY: Record<Processor, SettlementEntity> = {
  paystack: 'ng',
  stripe: 'us',
};

export interface InitChargeInput {
  /** Ledger transaction reference (already created by the caller). */
  reference: string;
  /** Customer e-mail for the processor's checkout page/receipt. */
  email: string;
  /** ISO currency the customer is charged in (presentment). */
  currency: string;
}

export interface InitChargeResult {
  reference: string;
  /** Redirect-style processors (Paystack) return a checkout URL. */
  authorization_url?: string;
  /** Client-secret-style processors (Stripe PaymentIntents) return this. */
  client_secret?: string;
  processor: Processor;
  [key: string]: unknown;
}

export interface ChargeVerification {
  reference: string;
  paid: boolean;
  amount_minor?: number;
  currency?: string;
  processor: Processor;
  raw?: unknown;
}

export interface RefundResult {
  reference: string;
  processor: Processor;
  ok: boolean;
  raw?: unknown;
}

export interface PayoutResult {
  reference?: string;
  processor: Processor;
  ok: boolean;
  raw?: unknown;
}

/** Charging side: init → (webhook/verify) → refund. */
export interface PaymentProvider {
  readonly processor: Processor;
  initCharge(input: InitChargeInput): Promise<InitChargeResult>;
  verifyCharge(reference: string): Promise<ChargeVerification>;
  /** Full refund of the original charge. */
  refund(reference: string): Promise<RefundResult>;
  /** Partial refund in minor units of the charge currency. */
  partialRefund(reference: string, amountMinor: number): Promise<RefundResult>;
}

/** Settlement side: make sure the vendor has an account, then pay out. */
export interface PayoutProvider {
  readonly processor: Processor;
  payout(
    businessId: string,
    amount: number,
    opts?: { reason?: string; reference?: string },
  ): Promise<PayoutResult>;
}
