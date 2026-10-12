import { describeOrder, OrderRow } from './vendor-ops.helpers';

/**
 * Pure computations behind the admin operations tools: which orders are
 * stuck and why, and how healthy each vendor is against the rest. No
 * database here, so it is testable with plain objects.
 */

const HOUR_MS = 3_600_000;

export const STUCK_THRESHOLDS = {
  /** Paid, and the vendor still has not confirmed. */
  unconfirmedHours: 24,
  /** Shipped this long ago and still not delivered. */
  inTransitDays: 10,
  /** Bespoke pre-ship photos waiting on the customer. */
  preshipHours: 48,
};

export interface StuckOrder extends OrderRow {
  vendor: string;
  /** Why it is on the list. */
  reason:
    | 'unconfirmed'
    | 'past_deadline'
    | 'in_transit_too_long'
    | 'preship_waiting_on_customer';
  /** Hours past the threshold or deadline - how bad. */
  hours_over: number;
}

export interface StuckOrdersReport {
  unconfirmed: StuckOrder[];
  past_deadline: StuckOrder[];
  in_transit_too_long: StuckOrder[];
  preship_waiting_on_customer: StuckOrder[];
  by_vendor: { vendor: string; stuck: number }[];
  total: number;
}

const hoursSince = (d: any, now: Date) =>
  d ? Math.round(((now.getTime() - new Date(d).getTime()) / HOUR_MS) * 10) / 10 : 0;

/**
 * Walk every vendor shipment on every open order and classify the ones that
 * have stopped moving. One order can appear under several vendors (each
 * shipment is its own fulfilment), and an order is listed once per reason.
 * `vendorName` turns a business id into a name for the list.
 */
export function stuckOrdersFrom(
  orders: any[],
  now: Date,
  vendorName: (businessId: string) => string = (id) => id,
): StuckOrdersReport {
  const report: StuckOrdersReport = {
    unconfirmed: [],
    past_deadline: [],
    in_transit_too_long: [],
    preship_waiting_on_customer: [],
    by_vendor: [],
    total: 0,
  };
  const perVendor = new Map<string, number>();
  const bump = (vendor: string) => perVendor.set(vendor, (perVendor.get(vendor) ?? 0) + 1);

  for (const order of orders) {
    if (order?.status === 'pending' || order?.payment_status === 'unpaid') continue;
    for (const shipment of order?.shipments || []) {
      const bid = String(shipment?.business ?? '');
      if (!bid) continue;
      const row = describeOrder(order, bid, now);
      const vendor = vendorName(bid);
      const base = { ...row, vendor };

      if (row.stage === 'awaiting_confirmation') {
        const age = row.age_hours ?? 0;
        if (age >= STUCK_THRESHOLDS.unconfirmedHours) {
          report.unconfirmed.push({ ...base, reason: 'unconfirmed', hours_over: Math.round((age - STUCK_THRESHOLDS.unconfirmedHours) * 10) / 10 });
          bump(vendor);
        }
      } else if (row.stage === 'awaiting_your_shipment' && row.overdue) {
        report.past_deadline.push({ ...base, reason: 'past_deadline', hours_over: Math.abs(row.hours_to_deadline ?? 0) });
        bump(vendor);
      } else if (row.stage === 'shipped') {
        const transit = hoursSince(shipment.shipped_at, now);
        if (transit >= STUCK_THRESHOLDS.inTransitDays * 24) {
          report.in_transit_too_long.push({ ...base, reason: 'in_transit_too_long', hours_over: Math.round((transit - STUCK_THRESHOLDS.inTransitDays * 24) * 10) / 10 });
          bump(vendor);
        }
      } else if (row.stage === 'preship_awaiting_customer') {
        const waiting = hoursSince(order?.preship?.submitted_at ?? order?.updatedAt, now);
        if (waiting >= STUCK_THRESHOLDS.preshipHours) {
          report.preship_waiting_on_customer.push({ ...base, reason: 'preship_waiting_on_customer', hours_over: Math.round((waiting - STUCK_THRESHOLDS.preshipHours) * 10) / 10 });
          bump(vendor);
        }
      }
    }
  }

  const worstFirst = (a: StuckOrder, b: StuckOrder) => b.hours_over - a.hours_over;
  report.unconfirmed.sort(worstFirst);
  report.past_deadline.sort(worstFirst);
  report.in_transit_too_long.sort(worstFirst);
  report.preship_waiting_on_customer.sort(worstFirst);
  report.by_vendor = [...perVendor.entries()].map(([vendor, stuck]) => ({ vendor, stuck })).sort((a, b) => b.stuck - a.stuck);
  report.total = report.unconfirmed.length + report.past_deadline.length + report.in_transit_too_long.length + report.preship_waiting_on_customer.length;
  return report;
}

// ── Vendor health ─────────────────────────────────────────────────────────

export interface VendorHealthInput {
  business_id: string;
  name: string;
  orders: number;
  shipped: number;
  late: number;
  cancelled: number;
  disputes: number;
  returns: number;
  rating: number | null;
  rating_count: number;
}

export interface VendorHealthRow extends VendorHealthInput {
  late_rate: number | null;
  cancel_rate: number | null;
  dispute_rate: number | null;
  return_rate: number | null;
  flags: string[];
}

export interface VendorHealthReport {
  medians: { late_rate: number | null; cancel_rate: number | null; dispute_rate: number | null; return_rate: number | null; rating: number | null };
  flagged: VendorHealthRow[];
  rows: VendorHealthRow[];
  vendors_assessed: number;
  /** Vendors with fewer orders than this are not rated - nothing to judge. */
  min_orders: number;
}

export const HEALTH_THRESHOLDS = {
  minOrders: 3,
  lateRate: 20,
  cancelRate: 10,
  disputeRate: 5,
  returnRate: 10,
  rating: 3.5,
};

const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export function median(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round(((xs[mid - 1] + xs[mid]) / 2) * 10) / 10;
}

/**
 * Rates per vendor, the platform medians, and who breaches the thresholds.
 * Vendors with too few orders in the window are listed but never flagged:
 * one late shipment out of one order is not a 100% late rate worth acting on.
 */
export function vendorHealth(inputs: VendorHealthInput[], thresholds = HEALTH_THRESHOLDS): VendorHealthReport {
  const rows: VendorHealthRow[] = inputs.map((v) => {
    const row: VendorHealthRow = {
      ...v,
      late_rate: pct(v.late, v.shipped),
      cancel_rate: pct(v.cancelled, v.orders),
      dispute_rate: pct(v.disputes, v.orders),
      return_rate: pct(v.returns, v.orders),
      flags: [],
    };
    if (v.orders >= thresholds.minOrders) {
      if ((row.late_rate ?? 0) > thresholds.lateRate) row.flags.push(`late on ${row.late_rate}% of shipments`);
      if ((row.cancel_rate ?? 0) > thresholds.cancelRate) row.flags.push(`${row.cancel_rate}% of orders cancelled`);
      if ((row.dispute_rate ?? 0) > thresholds.disputeRate) row.flags.push(`disputes on ${row.dispute_rate}% of orders`);
      if ((row.return_rate ?? 0) > thresholds.returnRate) row.flags.push(`${row.return_rate}% of orders returned`);
      if (v.rating !== null && v.rating_count >= 3 && v.rating < thresholds.rating) row.flags.push(`rated ${v.rating}/5`);
    }
    return row;
  });

  const assessed = rows.filter((r) => r.orders >= thresholds.minOrders);
  const medians = {
    late_rate: median(assessed.map((r) => r.late_rate)),
    cancel_rate: median(assessed.map((r) => r.cancel_rate)),
    dispute_rate: median(assessed.map((r) => r.dispute_rate)),
    return_rate: median(assessed.map((r) => r.return_rate)),
    rating: median(assessed.map((r) => r.rating)),
  };
  const flagged = rows.filter((r) => r.flags.length).sort((a, b) => b.flags.length - a.flags.length || b.orders - a.orders);
  return { medians, flagged, rows, vendors_assessed: assessed.length, min_orders: thresholds.minOrders };
}

// ── Search gaps ───────────────────────────────────────────────────────────

export interface SearchEventRow {
  query: string;
  /** Results the shopper saw; null/undefined when the event predates the field. */
  results?: number | null;
  at: Date | string;
}

export interface SearchGapTerm {
  term: string;
  searches: number;
  /** Searches that returned nothing; only events that recorded a count are judged. */
  zero_results: number;
  judged: number;
  zero_share: number | null;
  last_searched_at: string | null;
}

const normaliseTerm = (q: string) => String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Terms shoppers search for and do not find: demand the catalogue is not
 * supplying. Grouped case-insensitively; a term must be searched at least
 * `minSearches` times to count, so one typo does not make the list.
 */
export function searchGaps(rows: SearchEventRow[], minSearches = 2): { gaps: SearchGapTerm[]; top: SearchGapTerm[]; terms: number; searches: number } {
  const byTerm = new Map<string, SearchGapTerm>();
  for (const r of rows) {
    const term = normaliseTerm(r.query);
    if (!term) continue;
    const row = byTerm.get(term) ?? { term, searches: 0, zero_results: 0, judged: 0, zero_share: null, last_searched_at: null };
    row.searches++;
    if (typeof r.results === 'number') {
      row.judged++;
      if (r.results === 0) row.zero_results++;
    }
    const at = r.at instanceof Date ? r.at : new Date(r.at);
    if (!Number.isNaN(at.getTime()) && (!row.last_searched_at || at.toISOString() > row.last_searched_at)) row.last_searched_at = at.toISOString();
    byTerm.set(term, row);
  }
  const terms = [...byTerm.values()].map((t) => ({ ...t, zero_share: t.judged ? Math.round((t.zero_results / t.judged) * 100) : null }));
  const gaps = terms
    .filter((t) => t.searches >= minSearches && t.zero_share !== null && t.zero_share >= 50)
    .sort((a, b) => b.searches - a.searches || (b.zero_share ?? 0) - (a.zero_share ?? 0));
  const top = [...terms].sort((a, b) => b.searches - a.searches).slice(0, 15);
  return { gaps, top, terms: terms.length, searches: rows.length };
}
