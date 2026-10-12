import { bucketIndex, bucketSeries, resolveDashboardRange } from './dashboard-range';

// Wednesday 14 Oct 2026, 15:30 UTC = 16:30 in Lagos. Offsets are passed
// explicitly so the expectations hold on any machine.
const NOW = new Date('2026-10-14T15:30:00Z');
const LAGOS = 60;
const lagosMidnight = (iso: string) => new Date(`${iso}T00:00:00+01:00`);

describe('resolveDashboardRange', () => {
  it('defaults to the last 7 days, by day, with weekday labels and a 7-day previous window', () => {
    const r = resolveDashboardRange(undefined, NOW, LAGOS);
    expect(r.key).toBe('7d');
    expect(r.unit).toBe('day');
    expect(r.start).toEqual(lagosMidnight('2026-10-08'));
    expect(r.end).toBe(NOW);
    expect(r.prevStart).toEqual(lagosMidnight('2026-10-01'));
    expect(r.prevEnd).toEqual(r.start);
    expect(r.buckets.map((b) => b.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
    expect(r.days).toBe(7);
    expect(resolveDashboardRange('nonsense', NOW, LAGOS).key).toBe('7d');
  });

  it('puts day boundaries at Lagos midnight, not UTC midnight', () => {
    const r = resolveDashboardRange('7d', NOW, LAGOS);
    // 23:30 UTC on the 7th is 00:30 on the 8th in Lagos: inside the window.
    expect(bucketIndex(r, new Date('2026-10-07T23:30:00Z'))).toBe(0);
    expect(bucketIndex(r, new Date('2026-10-07T22:59:00Z'))).toBe(-1);
    // Independent of the process timezone: the same instants, offset 0, move.
    const utc = resolveDashboardRange('7d', NOW, 0);
    expect(bucketIndex(utc, new Date('2026-10-07T23:30:00Z'))).toBe(-1);
  });

  it('30 days labels each day with its date', () => {
    const r = resolveDashboardRange('30d', NOW, LAGOS);
    expect(r.buckets).toHaveLength(30);
    expect(r.start).toEqual(lagosMidnight('2026-09-15'));
    expect(r.buckets[0].label).toBe('15 Sep');
    expect(r.buckets[29].label).toBe('14 Oct');
    expect(r.prevStart).toEqual(lagosMidnight('2026-08-16'));
    expect(r.days).toBe(30);
  });

  it('12 weeks start on Mondays and end with the current week', () => {
    const r = resolveDashboardRange('12w', NOW, LAGOS);
    expect(r.unit).toBe('week');
    expect(r.buckets).toHaveLength(12);
    expect(r.buckets[11].start).toEqual(lagosMidnight('2026-10-12')); // Monday of this week
    expect(r.start).toEqual(lagosMidnight('2026-07-27'));
    expect(r.buckets[0].label).toBe('27 Jul');
    expect(r.prevStart).toEqual(lagosMidnight('2026-05-04'));
  });

  it("12 months start on the first of the month and mark last year's months with the year", () => {
    const r = resolveDashboardRange('12m', NOW, LAGOS);
    expect(r.unit).toBe('month');
    expect(r.start).toEqual(lagosMidnight('2025-11-01'));
    expect(r.buckets.map((b) => b.label)).toEqual([
      "Nov '25", "Dec '25", 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
    ]);
    expect(r.prevStart).toEqual(lagosMidnight('2024-11-01'));
    expect(r.prevEnd).toEqual(r.start);
  });
});

describe('bucketSeries', () => {
  it('sums into the right day, week and month, zero-fills the rest, and ignores rows outside the window', () => {
    const days = resolveDashboardRange('7d', NOW, LAGOS);
    expect(
      bucketSeries(days, [
        { at: new Date('2026-10-08T08:00:00Z'), value: 2 },
        { at: new Date('2026-10-08T22:30:00Z'), value: 3 }, // 23:30 Lagos, still the 8th
        { at: new Date('2026-10-14T00:30:00Z'), value: 1 },
        { at: new Date('2026-10-07T22:00:00Z'), value: 100 }, // 23:00 Lagos on the 7th: before the window
        { at: '2026-10-20T00:00:00Z', value: 100 }, // after it
      ]).map((p) => p.value),
    ).toEqual([5, 0, 0, 0, 0, 0, 1]);

    const weeks = resolveDashboardRange('12w', NOW, LAGOS);
    expect(bucketIndex(weeks, new Date('2026-10-11T12:00:00Z'))).toBe(10); // Sunday -> previous week
    expect(bucketIndex(weeks, new Date('2026-10-12T12:00:00Z'))).toBe(11); // Monday -> this week

    const months = resolveDashboardRange('12m', NOW, LAGOS);
    const series = bucketSeries(months, [
      { at: new Date('2025-11-30T23:30:00Z'), value: 10 }, // 00:30 on 1 Dec in Lagos
      { at: new Date('2026-10-01T05:00:00Z'), value: 7.555 },
    ]);
    expect(series[0]).toEqual({ label: "Nov '25", value: 0 });
    expect(series[1]).toEqual({ label: "Dec '25", value: 10 });
    expect(series[11]).toEqual({ label: 'Oct', value: 7.56 });
  });
});
