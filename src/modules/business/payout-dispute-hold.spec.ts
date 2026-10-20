import { BusinessEarningsCron } from './business-earning-cron';

/**
 * An open dispute holds the vendor's payout. Filing empties release_date, but
 * the delivery webhook and the stuck-earnings safety net both fill an empty
 * date back in, so the job that actually pays must check for itself.
 */
describe('Payout is held by an open dispute', () => {
  const earning = {
    _id: 'e1',
    order: 'o1',
    business: 'b1',
    net_amount: 54_000,
    milestone: 'completion',
    released: false,
    release_date: new Date(Date.now() - 1000),
  };

  const build = (openDispute: boolean) => {
    const updates: any[] = [];
    const cron: any = Object.create(BusinessEarningsCron.prototype);
    Object.assign(cron, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      businessEarningsModel: {
        find: async () => [earning],
        updateOne: async (filter: any, update: any) => {
          updates.push({ filter, update });
          return { modifiedCount: 1 };
        },
      },
      businessWalletModel: { findOneAndUpdate: jest.fn(async () => null) },
      disputeModel: { exists: async () => (openDispute ? { _id: 'd1' } : null) },
    });
    return { cron, updates };
  };

  it('does not release, and puts the earning back on hold', async () => {
    const { cron, updates } = build(true);
    await cron.releaseFunds();
    expect(cron.businessWalletModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { filter: { _id: 'e1', released: false }, update: { $set: { release_date: null } } },
    ]);
  });

  it('releases as normal when there is no open dispute', async () => {
    const { cron, updates } = build(false);
    await cron.releaseFunds().catch(() => undefined);
    // The claim (released: true) is the first write when nothing holds it.
    expect(updates[0].update.$set.released).toBe(true);
  });
});
