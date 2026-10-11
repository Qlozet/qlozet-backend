import { productFacts } from '../../recommendations/catalog/product-facts';

/**
 * Pure computations behind the vendor operations tools. Everything that can be
 * reasoned about without a database lives here, so it can be tested with plain
 * objects and the service stays a thin fetch-then-shape layer.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

const toDate = (v: any): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function hoursBetween(from: any, to: any): number | null {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return null;
  return Math.round(((b.getTime() - a.getTime()) / HOUR_MS) * 10) / 10;
}

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round(((xs[mid - 1] + xs[mid]) / 2) * 10) / 10;
}

export function average(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10;
}

const same = (a: any, b: any) => String(a ?? '') === String(b ?? '');

/** The vendor's own shipment record on a multi-vendor order. */
export function vendorShipment(order: any, bid: any): any | undefined {
  return (order?.shipments || []).find((s: any) => same(s?.business, bid));
}

/** The vendor's own, non-rejected line items on an order. */
export function vendorItems(order: any, bid: any): any[] {
  return (order?.items || []).filter((i: any) => same(i?.business, bid) && !i?.rejected);
}

export function vendorTotal(order: any, bid: any): number {
  return vendorItems(order, bid).reduce((s: number, i: any) => s + (Number(i?.total_price) || 0), 0);
}

export type OrderStage =
  | 'awaiting_payment'
  | 'awaiting_confirmation'
  | 'awaiting_your_shipment'
  | 'preship_changes_requested'
  | 'preship_awaiting_customer'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'returned'
  | 'rejected';

/** Stages where the next move is the vendor's. */
export const ACTION_STAGES: ReadonlySet<OrderStage> = new Set<OrderStage>([
  'awaiting_confirmation',
  'awaiting_your_shipment',
  'preship_changes_requested',
]);

export interface OrderRow {
  reference: string;
  status: string;
  type: string;
  stage: OrderStage;
  needs_action: boolean;
  placed_at: string | null;
  age_hours: number | null;
  items: number;
  amount: number;
  deadline: string | null;
  hours_to_deadline: number | null;
  overdue: boolean;
}

/**
 * Where an order stands from THIS vendor's point of view. The order's own
 * status is the customer's view; what the vendor owes is read from their
 * shipment record (confirmed / shipped / delivered) and, for bespoke, the
 * pre-ship checkpoint.
 */
export function describeOrder(order: any, bid: any, now: Date = new Date()): OrderRow {
  const shipment = vendorShipment(order, bid);
  const status = String(order?.status ?? '');
  const deadline = toDate(shipment?.fulfillment_deadline ?? order?.fulfillment_deadline);
  const shippedAt = toDate(shipment?.shipped_at);

  let stage: OrderStage;
  if (status === 'pending') stage = 'awaiting_payment';
  else if (status === 'cancelled') stage = 'cancelled';
  else if (status === 'returned') stage = 'returned';
  else if (status === 'completed') stage = 'completed';
  else if (shipment?.rejected) stage = 'rejected';
  else if (status === 'in_transit') stage = shipment?.delivered_at ? 'delivered' : 'shipped';
  else if (order?.preship?.status === 'changes_requested') stage = 'preship_changes_requested';
  else if (order?.preship?.status === 'pending_review') stage = 'preship_awaiting_customer';
  else if (!shipment?.confirmed) stage = 'awaiting_confirmation';
  else if (!shippedAt) stage = 'awaiting_your_shipment';
  else stage = 'shipped';

  const hoursToDeadline = deadline && !shippedAt ? hoursBetween(now, deadline) : null;
  return {
    reference: String(order?.reference ?? ''),
    status,
    type: String(order?.order_type ?? 'standard'),
    stage,
    needs_action: ACTION_STAGES.has(stage),
    placed_at: toDate(order?.createdAt)?.toISOString() ?? null,
    age_hours: hoursBetween(order?.createdAt, now),
    items: vendorItems(order, bid).length,
    amount: vendorTotal(order, bid),
    deadline: deadline?.toISOString() ?? null,
    hours_to_deadline: hoursToDeadline,
    overdue: !!deadline && !shippedAt && now.getTime() > deadline.getTime() && !['completed', 'cancelled', 'returned', 'rejected', 'delivered'].includes(stage),
  };
}

export interface FulfilmentStats {
  orders_handled: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  rejected: number;
  avg_hours_to_confirm: number | null;
  median_hours_to_confirm: number | null;
  avg_days_to_ship: number | null;
  median_days_to_ship: number | null;
  avg_days_in_transit: number | null;
  late_shipments: number;
  on_time_rate: string | null;
  still_open_past_deadline: number;
  late_penalties: { count: number; amount: number };
}

/** Speed and reliability of the vendor's fulfilment over a set of orders. */
export function fulfilmentStats(orders: any[], bid: any, now: Date = new Date()): FulfilmentStats {
  const confirmHours: number[] = [];
  const shipDays: number[] = [];
  const transitDays: number[] = [];
  let confirmed = 0, shipped = 0, delivered = 0, rejected = 0, late = 0, openLate = 0;
  let penaltyCount = 0, penaltyAmount = 0;

  for (const order of orders) {
    const s = vendorShipment(order, bid);
    if (!s) continue;
    if (s.rejected) { rejected++; continue; }
    if (s.confirmed_at) {
      confirmed++;
      const h = hoursBetween(order.createdAt, s.confirmed_at);
      if (h !== null) confirmHours.push(h);
    }
    const deadline = toDate(s.fulfillment_deadline ?? order.fulfillment_deadline);
    if (s.shipped_at) {
      shipped++;
      const h = hoursBetween(s.confirmed_at ?? order.createdAt, s.shipped_at);
      if (h !== null) shipDays.push(Math.round((h / 24) * 10) / 10);
      if (deadline && toDate(s.shipped_at)!.getTime() > deadline.getTime()) late++;
    } else if (deadline && now.getTime() > deadline.getTime() && !['cancelled', 'returned', 'completed'].includes(order.status)) {
      openLate++;
    }
    if (s.delivered_at && s.shipped_at) {
      delivered++;
      const h = hoursBetween(s.shipped_at, s.delivered_at);
      if (h !== null) transitDays.push(Math.round((h / 24) * 10) / 10);
    }
    if (order.late_penalty_applied) {
      penaltyCount++;
      penaltyAmount += Number(order.late_penalty_amount) || 0;
    }
  }

  const judged = shipped;
  return {
    orders_handled: orders.filter((o) => vendorShipment(o, bid)).length,
    confirmed,
    shipped,
    delivered,
    rejected,
    avg_hours_to_confirm: average(confirmHours),
    median_hours_to_confirm: median(confirmHours),
    avg_days_to_ship: average(shipDays),
    median_days_to_ship: median(shipDays),
    avg_days_in_transit: average(transitDays),
    late_shipments: late,
    on_time_rate: judged ? `${Math.round(((judged - late) / judged) * 100)}%` : null,
    still_open_past_deadline: openLate,
    late_penalties: { count: penaltyCount, amount: penaltyAmount },
  };
}

export interface QuoteStats {
  by_status: Record<string, number>;
  waiting_for_you: { reference: string; design: string | null; category: string | null; requested_at: string | null; age_hours: number | null }[];
  awaiting_customer: number;
  win_rate: string | null;
  decided: number;
  avg_quote_total: number | null;
  avg_accepted_total: number | null;
  avg_estimated_days: number | null;
  avg_hours_to_respond: number | null;
}

/** The bespoke quote funnel from the vendor's side. `design` may be populated. */
export function quoteStats(quotes: any[], now: Date = new Date()): QuoteStats {
  const by: Record<string, number> = {};
  const quoted: number[] = [];
  const accepted: number[] = [];
  const days: number[] = [];
  const respond: number[] = [];
  const waiting: QuoteStats['waiting_for_you'] = [];

  for (const q of quotes) {
    const st = String(q.status ?? 'unknown');
    by[st] = (by[st] ?? 0) + 1;
    if (st === 'pending' || st === 'draft' || st === 'revision_requested') {
      waiting.push({
        reference: String(q.reference ?? ''),
        design: q.design?.name ?? null,
        category: q.design?.category ?? null,
        requested_at: toDate(q.createdAt)?.toISOString() ?? null,
        age_hours: hoursBetween(q.createdAt, now),
      });
    }
    if (['submitted', 'accepted', 'declined', 'expired'].includes(st) && Number(q.total) > 0) quoted.push(Number(q.total));
    if (st === 'accepted' && Number(q.total) > 0) accepted.push(Number(q.total));
    if (Number(q.estimated_completion_days) > 0) days.push(Number(q.estimated_completion_days));
    const h = hoursBetween(q.createdAt, q.submitted_at);
    if (h !== null && h >= 0) respond.push(h);
  }

  waiting.sort((a, b) => (b.age_hours ?? 0) - (a.age_hours ?? 0));
  const won = by.accepted ?? 0;
  const decided = won + (by.declined ?? 0) + (by.expired ?? 0);
  return {
    by_status: by,
    waiting_for_you: waiting.slice(0, 10),
    awaiting_customer: by.submitted ?? 0,
    win_rate: decided ? `${Math.round((won / decided) * 100)}%` : null,
    decided,
    avg_quote_total: average(quoted),
    avg_accepted_total: average(accepted),
    avg_estimated_days: average(days),
    avg_hours_to_respond: average(respond),
  };
}

export const CATALOGUE_ISSUE_LABEL: Record<string, string> = {
  no_images: 'no photos',
  short_description: 'description missing or under 40 characters',
  no_audience: 'audience (men/women/unisex) not set',
  no_colours: 'no colours listed',
  no_sizes: 'no sizes listed',
  no_size_guide: 'no size guide attached',
  no_price: 'no price',
  out_of_stock: 'out of stock',
  stale_draft: 'draft for more than 14 days',
  no_views_30d: 'not viewed by anyone in 30 days',
};

const STALE_DRAFT_DAYS = 14;

/**
 * What is missing from one product listing. These are the fields search,
 * the home carousels and the shopper's AI stylist filter and rank on, so a
 * gap here is a product nobody is shown.
 */
export function catalogueIssues(product: any, now: Date = new Date(), views30d?: number): string[] {
  const issues: string[] = [];
  const kind = product?.kind;
  const sub = product?.[kind] ?? {};
  const facts = productFacts(product);

  if (!Array.isArray(sub.images) || sub.images.length === 0) issues.push('no_images');
  if (String(sub.description ?? '').trim().length < 40) issues.push('short_description');
  if (!facts.audience) issues.push('no_audience');
  if (!facts.colors.length) issues.push('no_colours');
  if ((kind === 'clothing' || kind === 'accessory') && !facts.sizes.length && facts.in_stock !== false) issues.push('no_sizes');
  if (kind === 'clothing' && !product?.size_guide) issues.push('no_size_guide');
  const price = kind === 'fabric' ? (facts.price_per_yard ?? Number(product?.base_price)) : Number(product?.base_price);
  if (!(price > 0)) issues.push('no_price');
  if (facts.in_stock === false) issues.push('out_of_stock');
  if (product?.status === 'draft') {
    const created = toDate(product?.createdAt);
    if (created && now.getTime() - created.getTime() > STALE_DRAFT_DAYS * DAY_MS) issues.push('stale_draft');
  }
  if (product?.status === 'active' && views30d === 0) issues.push('no_views_30d');
  return issues;
}

export interface ReviewStats {
  rated_products: number;
  total_ratings: number;
  average: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  lowest_rated: { product: string; average: number; ratings: number }[];
  highest_rated: { product: string; average: number; ratings: number }[];
  recent_low_comments: { product: string; rating: number; comment: string }[];
}

/** Ratings across the vendor's products. Ratings carry no dates, so "recent" means latest in array order. */
export function reviewStats(products: { name: string; ratings: { value: number; comment?: string }[] }[]): ReviewStats {
  const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let sum = 0, count = 0;
  const perProduct: { product: string; average: number; ratings: number }[] = [];
  const lowComments: ReviewStats['recent_low_comments'] = [];

  for (const p of products) {
    const rs = (p.ratings || []).filter((r) => Number(r?.value) >= 1 && Number(r?.value) <= 5);
    if (!rs.length) continue;
    let s = 0;
    for (const r of rs) {
      const v = Math.round(Number(r.value)) as 1 | 2 | 3 | 4 | 5;
      distribution[String(v) as keyof typeof distribution]++;
      s += Number(r.value);
      if (Number(r.value) <= 2 && String(r.comment ?? '').trim()) {
        lowComments.push({ product: p.name, rating: Number(r.value), comment: String(r.comment).trim().slice(0, 200) });
      }
    }
    sum += s;
    count += rs.length;
    perProduct.push({ product: p.name, average: Math.round((s / rs.length) * 10) / 10, ratings: rs.length });
  }

  const byAvg = [...perProduct].sort((a, b) => a.average - b.average || b.ratings - a.ratings);
  return {
    rated_products: perProduct.length,
    total_ratings: count,
    average: count ? Math.round((sum / count) * 10) / 10 : null,
    distribution,
    lowest_rated: byAvg.slice(0, 5),
    highest_rated: [...perProduct].sort((a, b) => b.average - a.average || b.ratings - a.ratings).slice(0, 5),
    recent_low_comments: lowComments.slice(-8).reverse(),
  };
}
