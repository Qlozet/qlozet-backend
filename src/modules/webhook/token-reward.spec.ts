import { Types } from 'mongoose';
import { WebhookService } from './webhook.service';
import { OrderSchema } from '../orders/schemas/orders.schema';
import { ReturnSchema } from '../returns/schemas/return.schema';
import { DisputeSchema } from '../disputes/schemas/dispute.schema';
import { TokenTransactionSchema } from '../wallets/schema/token.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';
import { OrderTokenRewardCron } from './order-token-reward.cron';
import {
  REWARD_LOOKBACK_DAYS,
  rewardBlock,
  rewardDueAt,
} from './order-token-reward';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/**
 * The order token reward (`order_payment_token_reward`) is paid after the
 * order is delivered and its return window has closed, never at payment, so
 * ordering and cancelling can't farm tokens.
 */
describe('order token reward', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let returnModel: any;
  let disputeModel: any;
  let txModel: any;
  let grant: jest.Mock;
  let settings: any;
  let cron: OrderTokenRewardCron;

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
    returnModel = mongo.model('Return', ReturnSchema);
    disputeModel = mongo.model('Dispute', DisputeSchema);
    txModel = mongo.model('TokenTransaction', TokenTransactionSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      orderModel.deleteMany({}),
      returnModel.deleteMany({}),
      disputeModel.deleteMany({}),
      txModel.deleteMany({}),
    ]);
    grant = jest.fn().mockResolvedValue(undefined);
    settings = { order_payment_token_reward: 45, return_window_days: 7 };
    cron = new OrderTokenRewardCron(
      { grant } as any,
      orderModel,
      returnModel,
      disputeModel,
      txModel,
      { findOne: () => ({ lean: async () => settings }) } as any,
    );
  });

  // Inserted raw, like orders saved before the field existed (no
  // token_reward_granted_at at all).
  const makeOrder = async (over: any = {}) => {
    const doc = {
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      customer: new Types.ObjectId(),
      items: [],
      status: 'completed',
      payment_status: 'paid',
      refund_status: 'none',
      shipments: [
        {
          business: new Types.ObjectId(),
          status: 'delivered',
          delivered_at: daysAgo(10),
        },
      ],
      ...over,
    };
    const { insertedId } = await orderModel.collection.insertOne(doc);
    return { ...doc, _id: insertedId };
  };

  describe('rules', () => {
    const ctx = {
      now: NOW,
      returnWindowDays: 7,
      openReturn: false,
      openDispute: false,
      fullDisputeRefund: false,
    };
    const order = (over: any = {}) => ({
      status: 'completed',
      payment_status: 'paid',
      refund_status: 'none',
      shipments: [{ delivered_at: daysAgo(10) }],
      ...over,
    });

    it('is due a return window after the LAST parcel arrives', () => {
      const due = rewardDueAt(
        {
          shipments: [
            { delivered_at: daysAgo(10) },
            { delivered_at: daysAgo(3) },
          ],
        },
        7,
      );
      expect(due).toEqual(new Date(daysAgo(3).getTime() + 7 * DAY));
    });

    it('waits while any parcel is on its way, but ignores rejected parcels and fabric hand-offs', () => {
      expect(
        rewardDueAt({ shipments: [{ delivered_at: daysAgo(10) }, {}] }, 7),
      ).toBeNull();
      expect(
        rewardDueAt(
          {
            shipments: [
              { delivered_at: daysAgo(10) },
              { rejected: true },
              { shipment_type: 'fabric_transfer' },
            ],
          },
          7,
        ),
      ).not.toBeNull();
      expect(rewardDueAt({ shipments: [] }, 7)).toBeNull();
    });

    it('pays a delivered order once the return window has closed', () => {
      expect(rewardBlock(order(), ctx)).toBeNull();
    });

    it('says why it will not pay', () => {
      expect(rewardBlock(order({ token_reward_granted_at: NOW }), ctx)).toBe(
        'already_rewarded',
      );
      expect(rewardBlock(order({ payment_status: 'unpaid' }), ctx)).toBe(
        'not_paid',
      );
      expect(rewardBlock(order({ status: 'cancelled' }), ctx)).toBe(
        'not_completed',
      );
      expect(rewardBlock(order({ status: 'returned' }), ctx)).toBe(
        'not_completed',
      );
      expect(rewardBlock(order({ refund_status: 'refunded' }), ctx)).toBe(
        'refunded',
      );
      expect(rewardBlock(order({ shipments: [{}] }), ctx)).toBe(
        'not_delivered',
      );
      expect(
        rewardBlock(order({ shipments: [{ delivered_at: daysAgo(5) }] }), ctx),
      ).toBe('window_open');
      expect(
        rewardBlock(
          order({
            shipments: [
              { delivered_at: daysAgo(7 + REWARD_LOOKBACK_DAYS + 1) },
            ],
          }),
          ctx,
        ),
      ).toBe('too_old');
      expect(rewardBlock(order(), { ...ctx, openReturn: true })).toBe(
        'open_return',
      );
      expect(rewardBlock(order(), { ...ctx, openDispute: true })).toBe(
        'open_dispute',
      );
      expect(rewardBlock(order(), { ...ctx, fullDisputeRefund: true })).toBe(
        'refunded_by_dispute',
      );
    });

    it('still pays after a partial refund (the customer kept part of the order)', () => {
      expect(rewardBlock(order({ refund_status: 'partial' }), ctx)).toBeNull();
    });
  });

  describe('hourly job', () => {
    it('pays the configured amount once and marks the order', async () => {
      const o = await makeOrder();
      expect(await cron.run(NOW)).toBe(1);
      expect(grant).toHaveBeenCalledTimes(1);
      const [recipient, amount, feature, meta] = grant.mock.calls[0];
      expect(recipient).toEqual({ customer: o.customer.toString() });
      expect(amount).toBe(45);
      expect(feature).toBe('reward:order_completed');
      expect(meta).toEqual({ order: o.reference });

      const saved = await orderModel.findById(o._id).lean();
      expect(saved.token_reward_granted_at).toEqual(NOW);

      // Later runs (and overlapping ones) never pay again.
      expect(await cron.run(new Date(NOW.getTime() + DAY))).toBe(0);
      expect(grant).toHaveBeenCalledTimes(1);
    });

    it('two runs at once pay one reward', async () => {
      await makeOrder();
      const [a, b] = await Promise.all([cron.run(NOW), cron.run(NOW)]);
      expect(a + b).toBe(1);
      expect(grant).toHaveBeenCalledTimes(1);
    });

    it('is off at 0', async () => {
      settings.order_payment_token_reward = 0;
      await makeOrder();
      expect(await cron.run(NOW)).toBe(0);
      expect(grant).not.toHaveBeenCalled();
    });

    it('skips cancelled, refunded, undelivered and still-returnable orders', async () => {
      await makeOrder({ status: 'cancelled' });
      await makeOrder({ refund_status: 'refunded' });
      await makeOrder({
        status: 'in_transit',
        shipments: [{ business: new Types.ObjectId(), status: 'in_transit' }],
      });
      await makeOrder({
        shipments: [
          { business: new Types.ObjectId(), delivered_at: daysAgo(3) },
        ],
      });
      expect(await cron.run(NOW)).toBe(0);
      expect(grant).not.toHaveBeenCalled();
    });

    it('waits for an open return or dispute, then pays once it is settled', async () => {
      const o = await makeOrder();
      const ret = await returnModel.collection.insertOne({
        order: String(o._id),
        status: 'requested',
      });
      expect(await cron.run(NOW)).toBe(0);

      await returnModel.collection.updateOne(
        { _id: ret.insertedId },
        { $set: { status: 'vendor_rejected' } },
      );
      await disputeModel.collection.insertOne({ order: o._id, status: 'open' });
      expect(await cron.run(NOW)).toBe(0);

      await disputeModel.collection.updateMany(
        {},
        { $set: { status: 'resolved_released' } },
      );
      expect(await cron.run(NOW)).toBe(1);
    });

    it('never pays an order a dispute refunded in full', async () => {
      const o = await makeOrder();
      await disputeModel.collection.insertOne({
        order: o._id,
        status: 'resolved_refund',
      });
      expect(await cron.run(NOW)).toBe(0);
      expect(grant).not.toHaveBeenCalled();
    });

    it('does not pay again for an order the old code rewarded at payment', async () => {
      const o = await makeOrder();
      await txModel.collection.insertOne({
        feature: 'reward:order_payment',
        type: 'earn',
        amount: 25,
        metadata: { order: o.reference },
      });
      expect(await cron.run(NOW)).toBe(0);
      expect(grant).not.toHaveBeenCalled();
      const saved = await orderModel.findById(o._id).lean();
      expect(saved.token_reward_granted_at).toEqual(NOW);
    });

    it('does not back-pay old orders when the reward is switched on', async () => {
      await makeOrder({
        shipments: [
          {
            business: new Types.ObjectId(),
            delivered_at: daysAgo(7 + REWARD_LOOKBACK_DAYS + 5),
          },
        ],
      });
      expect(await cron.run(NOW)).toBe(0);
    });

    it('tries again next run when the token grant fails', async () => {
      const o = await makeOrder();
      grant.mockRejectedValueOnce(new Error('token ledger down'));
      expect(await cron.run(NOW)).toBe(0);
      expect(
        (await orderModel.findById(o._id).lean()).token_reward_granted_at,
      ).toBeNull();
      expect(await cron.run(NOW)).toBe(1);
    });
  });

  describe('payment', () => {
    it('finalising a paid order no longer gives tokens', async () => {
      const service: any = Object.create(WebhookService.prototype);
      Object.assign(service, {
        logger: stubLogger,
        orderService: {
          announcePaidOrder: jest.fn().mockResolvedValue(undefined),
        },
        orderModel,
        businessService: {
          recordBusinessEarnings: jest.fn().mockResolvedValue(undefined),
        },
        productService: { updateInventory: jest.fn().mockResolvedValue({}) },
        eventModel: { insertMany: jest.fn().mockResolvedValue([]) },
        fabricClaimModel: { updateOne: jest.fn() },
        platformSettingsModel: {
          findOne: () => ({
            lean: async () => ({ order_payment_token_reward: 25 }),
          }),
        },
        tokenService: { grant },
      });
      const order = await orderModel.create({
        customer: new Types.ObjectId(),
        items: [],
        total: 30_000,
        subtotal: 30_000,
        status: 'pending',
        payment_status: 'unpaid',
        reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      });
      await service.finalizeCheckoutOrder({
        channel: 'checkout',
        order: { _id: order._id },
      });
      await new Promise((r) => setImmediate(r));

      expect(grant).not.toHaveBeenCalled();
      const saved = await orderModel.findById(order._id).lean();
      expect(saved.payment_status).toBe('paid');
    });
  });
});
