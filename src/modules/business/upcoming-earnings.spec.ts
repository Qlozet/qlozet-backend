import { BusinessService } from './business.service';

/**
 * The vendor wallet's "Next payouts" list: money earned but not yet in the
 * wallet, soonest first, with the order it came from and the total of every
 * upcoming payout (not just the page shown).
 */
describe('Upcoming earnings (next payouts)', () => {
  const BUSINESS = '6aa96c26ef5fdeff8d35d63b';

  const build = (rows: any[], total: number) => {
    const calls: any = {};
    const chain: any = {
      select: (s: string) => ((calls.select = s), chain),
      sort: (s: any) => ((calls.sort = s), chain),
      skip: (n: number) => ((calls.skip = n), chain),
      limit: (n: number) => ((calls.limit = n), chain),
      populate: (p: any) => ((calls.populate = p), chain),
      lean: () => chain,
      exec: async () => rows,
    };
    const model = {
      find: (f: any) => ((calls.filter = f), chain),
      countDocuments: async () => rows.length,
      aggregate: async (p: any) => ((calls.pipeline = p), [{ total }]),
    };
    const service: any = Object.create(BusinessService.prototype);
    service.businessEarningsModel = model;
    return { service, calls };
  };

  it('lists unreleased, non-zero payouts soonest first with the order reference', async () => {
    const date = new Date('2026-11-14T10:00:00Z');
    const { service, calls } = build(
      [
        {
          _id: 'e1',
          net_amount: 9000,
          release_date: date,
          milestone: 'completion',
          order: { _id: 'o1', reference: 'QLZ-123', type: 'standard' },
        },
      ],
      21500,
    );

    const res = await service.getUpcomingEarnings(BUSINESS);

    expect(calls.filter.released).toBe(false);
    expect(calls.filter.net_amount).toEqual({ $gt: 0 });
    expect(calls.sort).toEqual({ release_date: 1, _id: 1 });
    expect(res.data[0]).toMatchObject({
      order: 'o1',
      order_reference: 'QLZ-123',
      amount: 9000,
      label: '2026-11-14',
    });
    expect(res.total_amount).toBe(21500);
  });

  it('caps the page size at 50', async () => {
    const { service, calls } = build([], 0);
    const res = await service.getUpcomingEarnings(BUSINESS, { size: 500 });
    expect(calls.limit).toBe(50);
    expect(res.total_amount).toBe(0);
    expect(res.data).toEqual([]);
  });
});
