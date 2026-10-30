import { BusinessEarningsCron } from './business-earning-cron';
import { SETTLEMENT_DAYS } from './settlement';

/**
 * Payouts follow a fixed schedule (settlement.ts): due SETTLEMENT_DAYS after
 * the customer paid, and never held for a dispute or return (Paystack does not
 * allow holding vendor money on a condition).
 */
describe('Fixed payout schedule', () => {
  const earning = {
    _id: 'e1',
    order: 'o1',
    business: 'b1',
    net_amount: 54_000,
    milestone: 'completion',
    released: false,
    release_date: new Date(Date.now() - 1000),
  };

  const build = () => {
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
      // An open dispute and an open return exist; neither may hold the payout.
      disputeModel: { exists: async () => ({ _id: 'd1' }) },
      returnModel: { exists: async () => ({ _id: 'r1' }) },
    });
    return { cron, updates };
  };

  it('releases a due earning even with an open dispute or return', async () => {
    const { cron, updates } = build();
    await cron.releaseFunds().catch(() => undefined);
    // The claim (released: true) is the first write.
    expect(updates[0].update.$set.released).toBe(true);
  });

  it(`dates undated earnings ${SETTLEMENT_DAYS} days after they were recorded`, async () => {
    const recorded = new Date('2026-10-01T10:00:00Z');
    const updates: any[] = [];
    const cron: any = Object.create(BusinessEarningsCron.prototype);
    Object.assign(cron, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      businessEarningsModel: {
        find: () => ({
          select: () => ({ lean: async () => [{ _id: 'e2', createdAt: recorded }] }),
        }),
        updateOne: async (filter: any, update: any) => {
          updates.push({ filter, update });
          return { modifiedCount: 1 };
        },
      },
    });
    await cron.scheduleUndatedEarnings();
    expect(updates).toHaveLength(1);
    expect(updates[0].filter).toEqual({ _id: 'e2', released: false, release_date: null });
    expect(updates[0].update.$set.release_date.toISOString()).toBe('2026-10-15T10:00:00.000Z');
  });
});
