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
 * - The ship-by date a vendor is held to is the shipment's clock
 *   (shipClock below): the stored date, moved later for fabric from another
 *   shop that arrived late and for time spent waiting on a measurement
 *   answer, and paused while that fabric is still on its way.
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

/**
 * What the penalty is a percentage of: the store's items still on the order.
 *
 * A bespoke tailor's item carries only the deposit until the balance is paid
 * (bespoke-payment-plan.ts), but the order agreement and How orders work say
 * "a percentage of the order", so the unpaid balance counts too: a late
 * tailor is charged on the quote, paid in full or not (BUG-16).
 */
export function latePenaltyBase(order: any, businessId: string): number {
  const live = (order?.items ?? []).filter(
    (i: any) =>
      String(i?.business?._id ?? i?.business) === String(businessId) && !i?.rejected,
  );
  const items = live.reduce((sum: number, i: any) => sum + (Number(i?.total_price) || 0), 0);
  const plan = order?.payment_plan;
  const balanceUnpaid =
    !!plan &&
    live.length > 0 &&
    String(plan.tailor) === String(businessId) &&
    ['awaiting_deposit', 'deposit_paid', 'awaiting_balance'].includes(String(plan.status));
  return items + (balanceUnpaid ? Number(plan.balance_amount) || 0 : 0);
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

/** Days a tailor's clock is held while a measurement question waits. */
export const MEASUREMENT_PAUSE_DAYS = 3;

/** Why a shipment's clock is not running. */
export type ClockPause = 'balance' | 'fabric' | 'measurements';

export interface ShipClock {
  /** The ship-by date the vendor is held to; null while it is paused on fabric. */
  deadline: Date | null;
  paused: ClockPause | null;
  /**
   * While fabric from another shop is on its way: that shop's own send-by
   * date. The order is cancelled `abandon_after_days` after it if the fabric
   * never arrives (the fabric shop's failure, not the tailor's).
   */
  fabric_due: Date | null;
  /** The fabric shop's business id, while waiting on it. */
  fabric_shop: string | null;
}

const bizOf = (x: any) => String(x?._id ?? x ?? '');
const asDate = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The clock a vendor's shipment runs on.
 *
 * - Fabric from another shop is on its way to this vendor: the clock is
 *   paused (they cannot make or ship without it). Once it arrives they get
 *   their full making time from the arrival, if that is later than the
 *   stored date.
 * - A measurement question this vendor asked before the deadline: the time
 *   the customer took to answer, up to MEASUREMENT_PAUSE_DAYS, is added. An
 *   open question keeps adding until the cap, which holds the clock still.
 * - A bespoke order waiting on the customer's balance: paused (as before).
 */
export function shipClock(order: any, shipment: any, now: number = Date.now()): ShipClock {
  const stored = asDate(shipment?.fulfillment_deadline);
  const none: ShipClock = { deadline: stored, paused: null, fabric_due: null, fabric_shop: null };
  if (!stored) return none;
  const business = bizOf(shipment?.business);

  // Fabric another shop is sending to this vendor.
  const inbound = ((order?.shipments ?? []) as any[]).filter(
    (s) =>
      s?.shipment_type === 'fabric_transfer' &&
      !s?.rejected &&
      bizOf(s?.destination_business) === business &&
      bizOf(s?.business) !== business,
  );
  const pending = inbound.filter((s) => String(s?.status) !== 'delivered');
  if (shipment?.shipment_type !== 'fabric_transfer' && pending.length) {
    const dues = pending.map((s) => asDate(s?.fulfillment_deadline)).filter(Boolean) as Date[];
    return {
      deadline: null,
      paused: 'fabric',
      fabric_due: dues.length ? new Date(Math.max(...dues.map((d) => d.getTime()))) : null,
      fabric_shop: bizOf(pending[0]?.business) || null,
    };
  }

  let deadline = stored.getTime();
  if (shipment?.shipment_type !== 'fabric_transfer' && inbound.length) {
    const arrivals = inbound.map((s) => asDate(s?.delivered_at)).filter(Boolean) as Date[];
    const arrival = arrivals.length ? Math.max(...arrivals.map((d) => d.getTime())) : null;
    const making =
      Number(shipment?.making_days) > 0
        ? Number(shipment.making_days) * DAY
        : // Older orders: the window it was given, unless a paid balance
          // has already moved the stored date (which would inflate it).
          !order?.payment_plan?.balance_paid_at && asDate(shipment?.confirmed_at)
          ? stored.getTime() - asDate(shipment.confirmed_at)!.getTime()
          : 0;
    if (arrival !== null && making > 0) deadline = Math.max(deadline, arrival + making);
  }

  // Waiting on the customer's answer about measurements.
  const cap = MEASUREMENT_PAUSE_DAYS * DAY;
  let credit = 0;
  let waitingOnAnswer = false;
  for (const q of (order?.measurement_questions ?? []) as any[]) {
    if (bizOf(q?.business) !== business) continue;
    const asked = asDate(q?.asked_at);
    // Only a question asked in time: a late vendor cannot buy days with one.
    if (!asked || asked.getTime() >= deadline) continue;
    const end = asDate(q?.answered_at)?.getTime() ?? now;
    credit += Math.min(Math.max(end - asked.getTime(), 0), cap);
    if (q?.status === 'open' && now - asked.getTime() < cap) waitingOnAnswer = true;
  }
  deadline += credit;

  const balance = order?.payment_plan?.status === 'awaiting_balance';
  return {
    deadline: new Date(deadline),
    paused: balance ? 'balance' : waitingOnAnswer ? 'measurements' : null,
    fabric_due: null,
    fabric_shop: null,
  };
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
  /** The clock is not running (see paused_reason). */
  paused: boolean;
  /** Why: the customer's balance, fabric on its way, or a measurement answer. */
  paused_reason: ClockPause | null;
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
  const clock = shipClock(order, shipment, now);
  // While paused on fabric there is no date yet; show the stored one.
  const deadline = clock.deadline ?? asDate(shipment?.fulfillment_deadline);
  if (!deadline) return null;

  const base = latePenaltyBase(order, String(shipment?.business?._id ?? shipment?.business));
  const paused = clock.paused !== null;
  const perDay = Math.round(base * (Math.max(rules.perDayPercent, 0) / 100));
  // Fabric transfers are closed with the tailor's garment, never on their
  // own; and a vendor waiting on fabric is not the one who would be cancelled.
  const cancellable =
    rules.abandonAfterDays > 0 &&
    shipment?.shipment_type !== 'fabric_transfer' &&
    clock.paused !== 'fabric';
  return {
    ship_by: deadline,
    per_day: perDay,
    cap: latePenaltyTotal(base, Number.MAX_SAFE_INTEGER, rules),
    days_late: paused ? 0 : daysLate(deadline, now),
    charged: Number(shipment?.late_penalty_amount) || 0,
    cancel_on: cancellable ? new Date(deadline.getTime() + rules.abandonAfterDays * DAY) : null,
    paused,
    paused_reason: clock.paused,
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

/** Still waiting to ship, with its clock running: the date it is held to. */
function runningDeadline(order: any, shipment: any, now: number): Date | null {
  if (!shipment?.confirmed || shipment?.rejected) return null;
  if (MOVED.includes(String(shipment?.status))) return null;
  if (!['in_review', 'processing'].includes(String(order?.status))) return null;
  const clock = shipClock(order, shipment, now);
  // Paused clocks (balance, fabric, a measurement answer) are not warned
  // about: the date is not settled, and a moving date would re-warn hourly.
  return clock.paused ? null : clock.deadline;
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
  const deadline = runningDeadline(order, shipment, now);
  if (!deadline) return null;
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
  const deadline = runningDeadline(order, shipment, now);
  if (!deadline) return null;
  const cancelOn = new Date(deadline.getTime() + rules.abandonAfterDays * DAY);
  if (now >= cancelOn.getTime()) return null;
  if (sameTime(shipment?.cancel_warning_for, cancelOn)) return null;
  const lead = Math.min(CANCEL_WARNING_LEAD_DAYS, rules.abandonAfterDays / 2) * DAY;
  return now >= cancelOn.getTime() - lead ? cancelOn : null;
}
