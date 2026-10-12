/**
 * The vendor dashboard's time window, chosen from a few presets, and the
 * buckets a series is drawn in over it.
 *
 * One window for the whole page: the stat cards, their "vs previous period"
 * deltas, the breakdown charts and the two series all read the same range,
 * so the numbers on the page agree with each other. Before this the series
 * grouped ALL orders by weekday (Sun..Sat) while the cards covered the last
 * seven days - two different stories on one screen.
 */

export const DASHBOARD_RANGE_KEYS = ['7d', '30d', '12w', '12m'] as const;
export type DashboardRangeKey = (typeof DASHBOARD_RANGE_KEYS)[number];
export const DEFAULT_DASHBOARD_RANGE: DashboardRangeKey = '7d';

export type BucketUnit = 'day' | 'week' | 'month';

export interface DashboardBucket {
  start: Date;
  end: Date;
  label: string;
}

export interface DashboardRange {
  key: DashboardRangeKey;
  unit: BucketUnit;
  /** Human label: "Last 7 days". */
  label: string;
  /** Current window, half-open [start, end). */
  start: Date;
  end: Date;
  /** The equal-length window just before it, for deltas. */
  prevStart: Date;
  prevEnd: Date;
  buckets: DashboardBucket[];
}

const DAY_MS = 86_400_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

export function isDashboardRangeKey(v: unknown): v is DashboardRangeKey {
  return typeof v === 'string' && (DASHBOARD_RANGE_KEYS as readonly string[]).includes(v);
}

/** Unknown or missing input falls back to the default rather than erroring - a chart with a bad query string still draws. */
export function resolveDashboardRange(raw: unknown, now: Date = new Date()): DashboardRange {
  const key: DashboardRangeKey = isDashboardRangeKey(raw) ? raw : DEFAULT_DASHBOARD_RANGE;
  const today = startOfDay(now);

  if (key === '7d' || key === '30d') {
    const n = key === '7d' ? 7 : 30;
    const start = addDays(today, -(n - 1));
    const buckets: DashboardBucket[] = [];
    for (let i = 0; i < n; i++) {
      const s = addDays(start, i);
      buckets.push({
        start: s,
        end: addDays(start, i + 1),
        // A week reads as weekdays; a month needs the date.
        label: n === 7 ? DAYS[s.getDay()] : `${s.getDate()} ${MONTHS[s.getMonth()]}`,
      });
    }
    return {
      key,
      unit: 'day',
      label: `Last ${n} days`,
      start,
      end: now,
      prevStart: addDays(start, -n),
      prevEnd: start,
      buckets,
    };
  }

  if (key === '12w') {
    // Weeks start on Monday.
    const thisWeekStart = addDays(today, -((today.getDay() + 6) % 7));
    const start = addDays(thisWeekStart, -7 * 11);
    const buckets: DashboardBucket[] = [];
    for (let i = 0; i < 12; i++) {
      const s = addDays(start, 7 * i);
      buckets.push({ start: s, end: addDays(start, 7 * (i + 1)), label: `${s.getDate()} ${MONTHS[s.getMonth()]}` });
    }
    return {
      key,
      unit: 'week',
      label: 'Last 12 weeks',
      start,
      end: now,
      prevStart: addDays(start, -7 * 12),
      prevEnd: start,
      buckets,
    };
  }

  // 12m
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const buckets: DashboardBucket[] = [];
  for (let i = 0; i < 12; i++) {
    const s = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const sameYear = s.getFullYear() === now.getFullYear();
    buckets.push({
      start: s,
      end: new Date(start.getFullYear(), start.getMonth() + i + 1, 1),
      label: sameYear ? MONTHS[s.getMonth()] : `${MONTHS[s.getMonth()]} '${String(s.getFullYear()).slice(-2)}`,
    });
  }
  return {
    key,
    unit: 'month',
    label: 'Last 12 months',
    start,
    end: now,
    prevStart: new Date(start.getFullYear(), start.getMonth() - 12, 1),
    prevEnd: start,
    buckets,
  };
}

/** Which bucket a moment falls in, or -1 when outside the window. */
export function bucketIndex(range: DashboardRange, at: Date): number {
  if (at < range.start || at >= range.end) return -1;
  let i: number;
  if (range.unit === 'day') i = Math.floor((startOfDay(at).getTime() - range.start.getTime()) / DAY_MS);
  else if (range.unit === 'week') i = Math.floor((startOfDay(at).getTime() - range.start.getTime()) / (7 * DAY_MS));
  else i = monthIndex(at) - monthIndex(range.start);
  return i >= 0 && i < range.buckets.length ? i : -1;
}

/** Sum values into the range's buckets, zero-filling the empty ones, in order. */
export function bucketSeries(
  range: DashboardRange,
  rows: { at: Date | string; value: number }[],
): { label: string; value: number }[] {
  const totals = new Array<number>(range.buckets.length).fill(0);
  for (const row of rows) {
    const at = row.at instanceof Date ? row.at : new Date(row.at);
    if (Number.isNaN(at.getTime())) continue;
    const i = bucketIndex(range, at);
    if (i >= 0) totals[i] += Number(row.value) || 0;
  }
  return range.buckets.map((b, i) => ({ label: b.label, value: Math.round(totals[i] * 100) / 100 }));
}

/** The part of the response that tells the client what it is looking at. */
export function describeRange(range: DashboardRange) {
  return {
    key: range.key,
    unit: range.unit,
    label: range.label,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
  };
}
