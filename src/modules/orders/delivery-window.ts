// When a checkout parcel should arrive: the vendor's time to get it ready plus
// the courier's time on the road.
//
// The courier quote alone assumes pickup today, so a made-to-measure piece
// that takes two weeks to make looked like it would arrive in three days.
// The making part follows the same rule as the product page's estimate
// (shop lib/delivery-estimate.ts), so the two agree:
//   - an item with its own making time (made-to-measure clothing) takes that;
//   - anything else may ship the same day or as late as the platform default.
// It is an estimate for display. Deadlines are set when the vendor confirms.

export interface DayRange {
  min: number;
  max: number;
}

/** A product's own making time in days, or null when it has none. */
export function ownMakingDays(product: any): number | null {
  if (product?.kind !== 'clothing' || product?.clothing?.type !== 'customize') return null;
  const days = Number(product?.clothing?.turnaround_days);
  return Number.isFinite(days) && days > 0 ? Math.round(days) : null;
}

/** Days until one vendor's parcel is ready: the slowest item decides. */
export function makingWindow(products: any[], defaultDays: number): DayRange {
  let min = 0;
  let max = 0;
  for (const p of products) {
    const own = ownMakingDays(p);
    min = Math.max(min, own ?? 0);
    max = Math.max(max, own ?? defaultDays);
  }
  return { min, max: Math.max(min, max) };
}

/**
 * The courier's days on the road, read from its quote. Couriers send a phrase
 * ("Within 2 - 3 days", "Within 24 hrs") and an expected arrival time; either
 * may be the one that is filled in, so both are tried. Null when neither says.
 */
export function courierTransitDays(
  eta: unknown,
  etaTime: unknown,
  now: Date = new Date(),
): DayRange | null {
  for (const text of [eta, etaTime]) {
    const range = transitFromPhrase(text);
    if (range) return range;
  }
  for (const text of [etaTime, eta]) {
    const at = dateFrom(text);
    if (at) {
      const days = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 86_400_000));
      return { min: days, max: days };
    }
  }
  return null;
}

function transitFromPhrase(text: unknown): DayRange | null {
  const s = String(text ?? '').toLowerCase();
  if (!s || dateFrom(text)) return null;
  if (/same\s*day|today/.test(s)) return { min: 0, max: 0 };
  const nums = (s.match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => n >= 0);
  if (!nums.length) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (/hour|hr|min/.test(s)) {
    return { min: Math.max(0, Math.ceil(lo / 24)), max: Math.max(1, Math.ceil(hi / 24)) };
  }
  if (/week|wk/.test(s)) return { min: lo * 7, max: hi * 7 };
  if (/day/.test(s)) return { min: Math.round(lo), max: Math.round(hi) };
  return null;
}

function dateFrom(text: unknown): Date | null {
  const s = String(text ?? '').trim();
  // A real date has a year in it; "3-5 business days" must not parse as one.
  if (!/\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ArrivalWindow {
  /** YYYY-MM-DD */
  arrives_from: string;
  /** YYYY-MM-DD */
  arrives_to: string;
}

/** The arrival dates for one courier option. */
export function arrivalWindow(
  making: DayRange,
  transit: DayRange | null,
  fallbackTransit: DayRange,
  from: Date = new Date(),
): ArrivalWindow {
  const road = transit ?? fallbackTransit;
  const start = addDays(from, making.min + road.min);
  const end = addDays(from, Math.max(making.min + road.min, making.max + road.max));
  return { arrives_from: ymd(start), arrives_to: ymd(end) };
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
