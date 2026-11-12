/**
 * Late shipping: what it costs a vendor, and when the order is cancelled.
 *
 * One set of rules for the hourly penalty job (OrderService
 * .checkLateFulfillments), the 7-day cancellation (cancelAbandonedShipments)
 * and the preview the vendor app shows before any of it happens, so the
 * preview can never promise something the jobs do not do.
 *
 * - From the first minute past the ship-by date, each started day costs
 *   `late_penalty_percent_per_day` of the vendor's live items on the order,
 *   up to `late_penalty_max_percent`, paid to the customer.
 * - `abandon_after_days` past the ship-by date the shipment is cancelled and
 *   refunded (0 switches this off).
 * - A bespoke order waiting on the customer's balance is not late.
 */

const DAY = 24 * 60 * 60 * 1000;
const MOVED = ['shipped', 'in_transit', 'delivered'];

export interface LateRules {
  perDayPercent: number;
  maxPercent: number;
  abandonAfterDays: number;
}

export function lateRulesFrom(settings: any): LateRules {
  const num = (v: any, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    perDayPercent: num(settings?.late_penalty_percent_per_day, 5),
    maxPercent: num(settings?.late_penalty_max_percent, 25),
    abandonAfterDays: num(settings?.abandon_after_days, 7),
  };
}

/** What the penalty is a percentage of: the store's items still on the order. */
export function latePenaltyBase(order: any, businessId: string): number {
  return (order?.items ?? [])
    .filter(
      (i: any) =>
        String(i?.business?._id ?? i?.business) === String(businessId) && !i?.rejected,
    )
    .reduce((sum: number, i: any) => sum + (Number(i?.total_price) || 0), 0);
}

/** Started days past the deadline: one minute late is day 1. */
export function daysLate(deadline: Date, now: number): number {
  const ms = now - deadline.getTime();
  return ms > 0 ? Math.ceil(ms / DAY) : 0;
}

/** The total penalty after `days` late days. */
export function latePenaltyTotal(base: number, days: number, rules: LateRules): number {
  const percent = Math.min(days * rules.perDayPercent, rules.maxPercent);
  return Math.round(base * (Math.max(percent, 0) / 100));
}

export interface LatePreview {
  ship_by: Date;
  /** What each late day costs, and the most it can cost in all. */
  per_day: number;
  cap: number;
  days_late: number;
  /** Charged so far by the hourly job. */
  charged: number;
  /** When the shipment is cancelled if still not shipped; null when off. */
  cancel_on: Date | null;
  /** Waiting on the customer's bespoke balance: the clock does not run. */
  paused: boolean;
}

/** The preview for one shipment, or null when it is not waiting to ship. */
export function latePreviewFor(
  order: any,
  shipment: any,
  rules: LateRules,
  now: number = Date.now(),
): LatePreview | null {
  if (!shipment?.confirmed || shipment?.rejected) return null;
  if (MOVED.includes(String(shipment?.status))) return null;
  if (!['in_review', 'processing'].includes(String(order?.status))) return null;
  const deadline = shipment?.fulfillment_deadline
    ? new Date(shipment.fulfillment_deadline)
    : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return null;

  const base = latePenaltyBase(order, String(shipment?.business?._id ?? shipment?.business));
  const paused = order?.payment_plan?.status === 'awaiting_balance';
  const perDay = Math.round(base * (Math.max(rules.perDayPercent, 0) / 100));
  // Fabric transfers are closed with the tailor's garment, never on their own.
  const cancellable = rules.abandonAfterDays > 0 && shipment?.shipment_type !== 'fabric_transfer';
  return {
    ship_by: deadline,
    per_day: perDay,
    cap: latePenaltyTotal(base, Number.MAX_SAFE_INTEGER, rules),
    days_late: paused ? 0 : daysLate(deadline, now),
    charged: Number(shipment?.late_penalty_amount) || 0,
    cancel_on: cancellable ? new Date(deadline.getTime() + rules.abandonAfterDays * DAY) : null,
    paused,
  };
}

/**
 * The order as a vendor sees it, with `late_preview` on each of their
 * shipments still waiting to ship and, at the top, their own.
 */
export function withLatePreview<T extends Record<string, any>>(
  order: T,
  businessId: string,
  rules: LateRules,
  now: number = Date.now(),
): T {
  if (!order || !Array.isArray(order.shipments)) return order;
  let mine: LatePreview | null = null;
  const shipments = order.shipments.map((s: any) => {
    const preview = latePreviewFor(order, s, rules, now);
    if (!preview) return s;
    if (String(s?.business?._id ?? s?.business) === String(businessId) && !mine) {
      mine = preview;
    }
    return { ...s, late_preview: preview };
  });
  return { ...order, shipments, late_preview: mine };
}

// ── Warnings before the deadlines (OrderService.warnBeforeShipDeadlines) ──

/** Hours before the ship-by date that the vendor is reminded. */
export const SHIP_BY_WARNING_LEAD_HOURS = 24;
/** Days before the cancellation that the vendor is warned. */
export const CANCEL_WARNING_LEAD_DAYS = 2;

const HOUR = 60 * 60 * 1000;

/** Still waiting to ship, and lateness counts (not paused on a balance). */
function waitingToShip(order: any, shipment: any): boolean {
  if (!shipment?.confirmed || shipment?.rejected) return false;
  if (MOVED.includes(String(shipment?.status))) return false;
  if (!['in_review', 'processing'].includes(String(order?.status))) return false;
  return order?.payment_plan?.status !== 'awaiting_balance';
}

const sameTime = (a: any, b: Date) =>
  !!a && new Date(a).getTime() === b.getTime();

/**
 * Whether to remind the vendor that the ship-by date is close: inside the
 * last 24 hours (or the second half of a shorter window), not yet passed,
 * and not already reminded for this deadline. A deadline that moves later
 * (a bespoke balance paid) gets its own reminder.
 */
export function shipByWarningDue(order: any, shipment: any, now: number = Date.now()): Date | null {
  if (!waitingToShip(order, shipment)) return null;
  const deadline = shipment?.fulfillment_deadline ? new Date(shipment.fulfillment_deadline) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return null;
  if (now >= deadline.getTime()) return null;
  if (sameTime(shipment?.ship_by_warning_for, deadline)) return null;
  const start = shipment?.confirmed_at ? new Date(shipment.confirmed_at).getTime() : null;
  const window = start ? deadline.getTime() - start : Infinity;
  const lead = Math.min(SHIP_BY_WARNING_LEAD_HOURS * HOUR, window / 2);
  return now >= deadline.getTime() - lead ? deadline : null;
}

/**
 * Whether to warn the vendor that the order is about to be cancelled for
 * not shipping: inside the last 2 days before it (half the stage if it is
 * shorter), and once per cancellation date. Null when cancellation is off.
 */
export function cancelWarningDue(
  order: any,
  shipment: any,
  rules: LateRules,
  now: number = Date.now(),
): Date | null {
  if (!(rules.abandonAfterDays > 0)) return null;
  if (shipment?.shipment_type === 'fabric_transfer') return null;
  if (!waitingToShip(order, shipment)) return null;
  const deadline = shipment?.fulfillment_deadline ? new Date(shipment.fulfillment_deadline) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return null;
  const cancelOn = new Date(deadline.getTime() + rules.abandonAfterDays * DAY);
  if (now >= cancelOn.getTime()) return null;
  if (sameTime(shipment?.cancel_warning_for, cancelOn)) return null;
  const lead = Math.min(CANCEL_WARNING_LEAD_DAYS, rules.abandonAfterDays / 2) * DAY;
  return now >= cancelOn.getTime() - lead ? cancelOn : null;
}
