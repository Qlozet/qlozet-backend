/**
 * A dashboard's time window, chosen from a few presets, and the buckets a
 * series is drawn in over it. Shared by the vendor dashboard (/orders/chart,
 * /business/earnings-chart) and the admin one (/admin/dashboard/charts).
 *
 * One window for the whole page: the stat cards, their "vs previous period"
 * deltas, the breakdown charts and the series all read the same range, so the
 * numbers on a page agree with each other. Before this the series grouped
 * ALL orders by weekday (Sun..Sat) while the cards covered the last seven
 * days - two different stories on one screen.
 *
 * Days are platform days: boundaries fall at midnight in Africa/Lagos (UTC+1,
 * no DST) whatever the server's clock says, so a 00:30 Lagos order counts on
 * the day the vendor sees it placed. All arithmetic is done on a "wall clock"
 * copy of the instant with UTC getters, which keeps it independent of the
 * process timezone; the Dates handed back are true instants.
 */

export const DASHBOARD_RANGE_KEYS = ['7d', '30d', '12w', '12m'] as const;
export type DashboardRangeKey = (typeof DASHBOARD_RANGE_KEYS)[number];
export const DEFAULT_DASHBOARD_RANGE: DashboardRangeKey = '7d';

/** Africa/Lagos. The marketplace's day, not the server's. */
export const PLATFORM_TZ_OFFSET_MINUTES = 60;

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
  /** Whole days in the current window, for "period_days"-style fields. */
  days: number;
  tzOffsetMinutes: number;
}

const DAY_MS = 86_400_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isDashboardRangeKey(v: unknown): v is DashboardRangeKey {
  return typeof v === 'string' && (DASHBOARD_RANGE_KEYS as readonly string[]).includes(v);
}

/**
 * Unknown or missing input falls back to the default rather than erroring - a
 * chart with a bad query string still draws.
 */
export function resolveDashboardRange(
  raw: unknown,
  now: Date = new Date(),
  tzOffsetMinutes: number = PLATFORM_TZ_OFFSET_MINUTES,
): DashboardRange {
  const key: DashboardRangeKey = isDashboardRangeKey(raw) ? raw : DEFAULT_DASHBOARD_RANGE;
  const off = tzOffsetMinutes * 60_000;
  // Wall-clock time in the platform zone, carried as a UTC Date so the UTC
  // getters and Date.UTC read and build wall-clock values directly.
  const wallNow = new Date(now.getTime() + off);
  const todayW = Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth(), wallNow.getUTCDate());
  const real = (wallMs: number) => new Date(wallMs - off);
  const dayLabel = (wallMs: number) => {
    const d = new Date(wallMs);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };
  const finish = (
    key: DashboardRangeKey,
    unit: BucketUnit,
    label: string,
    startW: number,
    prevStartW: number,
    bucketsW: { startW: number; endW: number; label: string }[],
  ): DashboardRange => ({
    key,
    unit,
    label,
    start: real(startW),
    end: now,
    prevStart: real(prevStartW),
    prevEnd: real(startW),
    buckets: bucketsW.map((b) => ({ start: real(b.startW), end: real(b.endW), label: b.label })),
    days: Math.round((now.getTime() - real(startW).getTime()) / DAY_MS) || 1,
    tzOffsetMinutes,
  });

  if (key === '7d' || key === '30d') {
    const n = key === '7d' ? 7 : 30;
    const startW = todayW - (n - 1) * DAY_MS;
    const buckets = Array.from({ length: n }, (_, i) => {
      const s = startW + i * DAY_MS;
      return {
        startW: s,
        endW: s + DAY_MS,
        // A week reads as weekdays; a month needs the date.
        label: n === 7 ? DAYS[new Date(s).getUTCDay()] : dayLabel(s),
      };
    });
    return finish(key, 'day', `Last ${n} days`, startW, startW - n * DAY_MS, buckets);
  }

  if (key === '12w') {
    // Weeks start on Monday.
    const dow = new Date(todayW).getUTCDay();
    const thisWeekW = todayW - ((dow + 6) % 7) * DAY_MS;
    const startW = thisWeekW - 11 * 7 * DAY_MS;
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const s = startW + i * 7 * DAY_MS;
      return { startW: s, endW: s + 7 * DAY_MS, label: dayLabel(s) };
    });
    return finish(key, 'week', 'Last 12 weeks', startW, startW - 12 * 7 * DAY_MS, buckets);
  }

  // 12m
  const y = wallNow.getUTCFullYear();
  const m = wallNow.getUTCMonth();
  const monthW = (k: number) => Date.UTC(y, m - 11 + k, 1);
  const startW = monthW(0);
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const s = new Date(monthW(i));
    const sameYear = s.getUTCFullYear() === y;
    return {
      startW: monthW(i),
      endW: monthW(i + 1),
      label: sameYear
        ? MONTHS[s.getUTCMonth()]
        : `${MONTHS[s.getUTCMonth()]} '${String(s.getUTCFullYear()).slice(-2)}`,
    };
  });
  return finish(key, 'month', 'Last 12 months', startW, Date.UTC(y, m - 23, 1), buckets);
}

/** Which bucket an instant falls in, or -1 when outside the window. */
export function bucketIndex(range: DashboardRange, at: Date): number {
  const t = at.getTime();
  const start = range.start.getTime();
  if (t < start || t >= range.end.getTime()) return -1;
  let i: number;
  if (range.unit === 'day') i = Math.floor((t - start) / DAY_MS);
  else if (range.unit === 'week') i = Math.floor((t - start) / (7 * DAY_MS));
  else {
    const off = range.tzOffsetMinutes * 60_000;
    const w = new Date(t + off);
    const s = new Date(start + off);
    i = (w.getUTCFullYear() * 12 + w.getUTCMonth()) - (s.getUTCFullYear() * 12 + s.getUTCMonth());
  }
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
  // Money is summed in naira; round to kobo so float addition never shows.
  return range.buckets.map((b, i) => ({ label: b.label, value: Math.round(totals[i] * 100) / 100 }));
}

/** The part of a response that tells the client what it is looking at. */
export function describeRange(range: DashboardRange) {
  return {
    key: range.key,
    unit: range.unit,
    label: range.label,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    days: range.days,
  };
}
