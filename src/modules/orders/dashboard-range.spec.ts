import { bucketIndex, bucketSeries, resolveDashboardRange } from './dashboard-range';

// A Wednesday, mid-afternoon, so weeks and days have somewhere to land.
const NOW = new Date(2026, 9, 14, 15, 30); // 14 Oct 2026

describe('resolveDashboardRange', () => {
  it('defaults to the last 7 days, by day, with weekday labels and a 7-day previous window', () => {
    const r = resolveDashboardRange(undefined, NOW);
    expect(r.key).toBe('7d');
    expect(r.unit).toBe('day');
    expect(r.start).toEqual(new Date(2026, 9, 8));
    expect(r.end).toBe(NOW);
    expect(r.prevStart).toEqual(new Date(2026, 9, 1));
    expect(r.prevEnd).toEqual(r.start);
    expect(r.buckets.map((b) => b.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
    expect(resolveDashboardRange('nonsense', NOW).key).toBe('7d');
  });

  it('30 days labels each day with its date', () => {
    const r = resolveDashboardRange('30d', NOW);
    expect(r.buckets).toHaveLength(30);
    expect(r.start).toEqual(new Date(2026, 8, 15));
    expect(r.buckets[0].label).toBe('15 Sep');
    expect(r.buckets[29].label).toBe('14 Oct');
    expect(r.prevStart).toEqual(new Date(2026, 7, 16));
  });

  it('12 weeks start on Mondays and end with the current week', () => {
    const r = resolveDashboardRange('12w', NOW);
    expect(r.unit).toBe('week');
    expect(r.buckets).toHaveLength(12);
    const last = r.buckets[11];
    expect(last.start).toEqual(new Date(2026, 9, 12)); // Monday of this week
    expect(last.start.getDay()).toBe(1);
    expect(r.start).toEqual(new Date(2026, 6, 27));
    expect(r.buckets[0].label).toBe('27 Jul');
    expect(r.prevStart).toEqual(new Date(2026, 4, 4));
  });

  it("12 months start on the first of the month and mark last year's months with the year", () => {
    const r = resolveDashboardRange('12m', NOW);
    expect(r.unit).toBe('month');
    expect(r.start).toEqual(new Date(2025, 10, 1));
    expect(r.buckets.map((b) => b.label)).toEqual([
      "Nov '25", "Dec '25", 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
    ]);
    expect(r.prevStart).toEqual(new Date(2024, 10, 1));
    expect(r.prevEnd).toEqual(r.start);
  });
});

describe('bucketSeries', () => {
  it('sums into the right day, week and month, zero-fills the rest, and ignores rows outside the window', () => {
    const days = resolveDashboardRange('7d', NOW);
    expect(
      bucketSeries(days, [
        { at: new Date(2026, 9, 8, 9), value: 2 },
        { at: new Date(2026, 9, 8, 23), value: 3 },
        { at: new Date(2026, 9, 14, 1), value: 1 },
        { at: new Date(2026, 9, 7, 23, 59), value: 100 }, // just before the window
        { at: '2026-10-20T00:00:00Z', value: 100 }, // after it
      ]).map((p) => p.value),
    ).toEqual([5, 0, 0, 0, 0, 0, 1]);

    const weeks = resolveDashboardRange('12w', NOW);
    expect(bucketIndex(weeks, new Date(2026, 9, 11))).toBe(10); // Sunday -> previous week bucket
    expect(bucketIndex(weeks, new Date(2026, 9, 12))).toBe(11); // Monday -> this week

    const months = resolveDashboardRange('12m', NOW);
    const series = bucketSeries(months, [
      { at: new Date(2025, 10, 30), value: 10 },
      { at: new Date(2026, 9, 1), value: 7.555 },
    ]);
    expect(series[0]).toEqual({ label: "Nov '25", value: 10 });
    expect(series[11]).toEqual({ label: 'Oct', value: 7.56 });
  });
});
