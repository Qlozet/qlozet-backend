/**
 * Bespoke orders are paid in two parts: a deposit when the customer accepts
 * the tailor's quote, and the balance when the tailor shows the finished
 * piece (the pre-ship photos). Each payment follows the normal fixed payout
 * schedule (settlement.ts); nothing is held waiting for an event, the balance
 * simply isn't charged until the garment exists.
 *
 * While only the deposit is paid, the tailor's order item carries the DEPOSIT
 * as its total_price (and the order total is what was actually charged), so
 * every refund, penalty and cancellation that reads item.total_price stays
 * bounded by money really received. Paying the balance raises both by the
 * balance. The full quote lives on `payment_plan.quote_total`.
 */

export type PaymentPlanStatus =
  | 'awaiting_deposit'
  | 'deposit_paid'
  | 'awaiting_balance'
  | 'paid'
  | 'forfeited';

export interface PaymentPlan {
  kind: 'deposit';
  /** The tailor's business id (the item whose price is split). */
  tailor: string;
  /** The tailor's full quoted price. */
  quote_total: number;
  deposit_percent: number;
  /** Tailor share charged at acceptance (fabric from another vendor is extra). */
  deposit_amount: number;
  balance_amount: number;
  status: PaymentPlanStatus;
  deposit_paid_at?: Date | null;
  /** Set when the tailor sends finished-piece photos; paused while changes are requested. */
  balance_due_at?: Date | null;
  balance_paid_at?: Date | null;
  balance_reference?: string | null;
  reminders_sent?: number;
  forfeited_at?: Date | null;
}

export const DEFAULT_DEPOSIT_PERCENT = 50;
export const DEFAULT_BALANCE_DAYS = 14;
/** Days the tailor gets to ship once the balance lands, at least. */
export const SHIP_AFTER_BALANCE_DAYS = 3;
/** Balance reminders, in days after the photos were sent. */
export const BALANCE_REMINDER_DAYS = [2, 5];

const DAY_MS = 24 * 60 * 60 * 1000;

export function depositPercentFrom(settings: any): number {
  const raw = Number(settings?.bespoke_deposit_percent);
  if (!Number.isFinite(raw)) return DEFAULT_DEPOSIT_PERCENT;
  return Math.min(Math.max(Math.round(raw), 0), 100);
}

export function balanceDaysFrom(settings: any): number {
  const raw = Number(settings?.bespoke_balance_days);
  return Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : DEFAULT_BALANCE_DAYS;
}

/**
 * The split for a quote, or null when it is paid in one go (deposit set to
 * 0% or 100%, or a quote too small to split).
 */
export function buildPaymentPlan(
  tailor: string,
  quoteTotal: number,
  depositPercent: number,
): PaymentPlan | null {
  const total = Math.round(Number(quoteTotal) || 0);
  if (depositPercent <= 0 || depositPercent >= 100 || total < 2) return null;
  const deposit = Math.min(Math.max(Math.round((total * depositPercent) / 100), 1), total - 1);
  return {
    kind: 'deposit',
    tailor: String(tailor),
    quote_total: total,
    deposit_percent: depositPercent,
    deposit_amount: deposit,
    balance_amount: total - deposit,
    status: 'awaiting_deposit',
    deposit_paid_at: null,
    balance_due_at: null,
    balance_paid_at: null,
    balance_reference: null,
    reminders_sent: 0,
    forfeited_at: null,
  };
}

/** True while the customer still owes the balance. */
export function balanceOutstanding(plan?: PaymentPlan | null): boolean {
  return (
    !!plan &&
    plan.kind === 'deposit' &&
    (plan.status === 'deposit_paid' || plan.status === 'awaiting_balance')
  );
}

export function balanceDueAt(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/** Which reminder (0-based) is due now, or -1. */
export function reminderDue(plan: PaymentPlan, readyAt: Date | null | undefined, now = new Date()): number {
  if (plan.status !== 'awaiting_balance' || !readyAt) return -1;
  const sent = plan.reminders_sent ?? 0;
  if (sent >= BALANCE_REMINDER_DAYS.length) return -1;
  const elapsedDays = (now.getTime() - new Date(readyAt).getTime()) / DAY_MS;
  return elapsedDays >= BALANCE_REMINDER_DAYS[sent] ? sent : -1;
}
