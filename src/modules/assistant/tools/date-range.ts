/**
 * Resolves a tool's time window from EITHER a preset `period` enum OR an explicit
 * custom range (`start_date`/`end_date`). Custom dates win when provided, so
 * vendors get quick presets *and* arbitrary ranges. All ranges are half-open
 * [start, end). `now` is injected so callers stay testable.
 */

export const PERIOD_ENUM = [
  'today',
  'this_week',
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_year',
] as const;

export type Period = (typeof PERIOD_ENUM)[number];

export interface ResolvedRange {
  start: Date;
  end: Date;
  label: string;
}

export interface RangeArgs {
  period?: string;
  start_date?: string;
  end_date?: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function resolveRange(args: RangeArgs, now: Date = new Date()): ResolvedRange {
  // 1) Explicit custom range takes precedence.
  const cs = args.start_date ? new Date(args.start_date) : null;
  const ce = args.end_date ? new Date(args.end_date) : null;
  if (cs && !Number.isNaN(cs.getTime())) {
    const end = ce && !Number.isNaN(ce.getTime()) ? ce : now;
    // Make end inclusive of the whole end day.
    const endExclusive = new Date(end);
    endExclusive.setHours(23, 59, 59, 999);
    return {
      start: cs,
      end: endExclusive,
      label: `${cs.toISOString().slice(0, 10)} → ${end
        .toISOString()
        .slice(0, 10)}`,
    };
  }

  // 2) Preset period.
  const period = (args.period as Period) ?? 'this_month';
  const today = startOfDay(now);

  switch (period) {
    case 'today':
      return { start: today, end: now, label: 'today' };

    case 'this_week': {
      const start = startOfDay(now);
      start.setDate(now.getDate() - now.getDay()); // Sunday-based week start
      return { start, end: now, label: 'this week' };
    }

    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: now, label: 'this month' };
    }

    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end, label: 'last month' };
    }

    case 'last_7_days': {
      const start = startOfDay(now);
      start.setDate(now.getDate() - 7);
      return { start, end: now, label: 'the last 7 days' };
    }

    case 'last_30_days': {
      const start = startOfDay(now);
      start.setDate(now.getDate() - 30);
      return { start, end: now, label: 'the last 30 days' };
    }

    case 'last_90_days': {
      const start = startOfDay(now);
      start.setDate(now.getDate() - 90);
      return { start, end: now, label: 'the last 90 days' };
    }

    case 'this_year': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, end: now, label: 'this year' };
    }

    default: {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: now, label: 'this month' };
    }
  }
}

/** The equal-length window immediately before [start, end) — for deltas. */
export function priorRange(range: ResolvedRange): ResolvedRange {
  const span = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - span),
    end: new Date(range.start.getTime()),
    label: 'the prior period',
  };
}
