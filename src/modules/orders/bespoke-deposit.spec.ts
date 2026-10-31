import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { BusinessService } from '../business/business.service';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';
import {
  buildPaymentPlan,
  depositPercentFrom,
  reminderDue,
} from './bespoke-payment-plan';

/**
 * Bespoke orders are paid as a deposit at quote acceptance and a balance
 * when the tailor shows the finished piece. The tailor can't ship until the
 * balance lands, the customer's refunds never exceed what they paid, and an
 * unpaid balance closes the order with the tailor keeping the deposit.
 */

describe('bespoke payment plan rules', () => {
  it('splits a quote into deposit and balance', () => {
    const plan = buildPaymentPlan('t1', 90_000, 50)!;
    expect(plan.deposit_amount).toBe(45_000);
    expect(plan.balance_amount).toBe(45_000);
    expect(plan.status).toBe('awaiting_deposit');
    expect(buildPaymentPlan('t1', 100_001, 30)!.deposit_amount + buildPaymentPlan('t1', 100_001, 30)!.balance_amount).toBe(100_001);
  });

  it('pays in full when the deposit is 0% or 100%', () => {
    expect(buildPaymentPlan('t1', 90_000, 0)).toBeNull();
    expect(buildPaymentPlan('t1', 90_000, 100)).toBeNull();
  });

  it('defaults the deposit to 50% and clamps bad settings', () => {
    expect(depositPercentFrom({})).toBe(50);
    expect(depositPercentFrom({ bespoke_deposit_percent: 140 })).toBe(100);
    expect(depositPercentFrom({ bespoke_deposit_percent: 30 })).toBe(30);
  });

  it('reminds on day 2 and day 5 after the photos', () => {
    const plan: any = { status: 'awaiting_balance', reminders_sent: 0 };
    const ready = new Date('2026-11-01T00:00:00Z');
    expect(reminderDue(plan, ready, new Date('2026-11-02T00:00:00Z'))).toBe(-1);
    expect(reminderDue(plan, ready, new Date('2026-11-03T01:00:00Z'))).toBe(0);
    expect(reminderDue({ ...plan, reminders_sent: 1 }, ready, new Date('2026-11-04T00:00:00Z'))).toBe(-1);
    expect(reminderDue({ ...plan, reminders_sent: 1 }, ready, new Date('2026-11-06T01:00:00Z'))).toBe(1);
    expect(reminderDue({ ...plan, reminders_sent: 2 }, ready, new Date('2026-11-20T00:00:00Z'))).toBe(-1);
  });
});

describe('bespoke deposit orders (real Mongo)', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let orders: any;
  let business: any;
  let earnings: any[];
  let walletIncs: any[];
  let notify: jest.Mock;

  const customerId = new Types.ObjectId();
  const tailorId = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    earnings = [];
    walletIncs = [];
    notify = jest.fn().mockResolvedValue({});
    const settings = {
      platform_commission_type: 'percent',
      platform_commission_percent: 10,
      bespoke_balance_days: 14,
      custom_cancellation_fee_percent: 30,
    };
    const lean = (v: any) => ({ lean: async () => v });

    business = Object.create(BusinessService.prototype);
    Object.assign(business, {
      logger: stubLogger,
      orderModel,
      platformSettingsModel: { findOne: () => lean(settings) },
      businessEarningsModel: {
        exists: async (q: any) =>
          earnings.some((e) => String(e.order) === String(q.order) && e.milestone === q.milestone),
        create: async (doc: any) => earnings.push(doc),
      },
      walletModel: {
        findOneAndUpdate: async (_q: any, u: any) => walletIncs.push(u),
      },
    });

    orders = Object.create(OrderService.prototype);
    Object.assign(orders, {
      logger: stubLogger,
      productionStepDefs: [{ key: 'sewing', label: 'Sewing', description: '' }],
      orderModel,
      businessService: business,
      notificationsService: { create: notify },
      vendorRecipients: { resolve: async () => [{ userId: 'u1' }] },
      platformSettingsModel: { findOne: () => lean(settings) },
      productModel: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
      businessModel: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    });
  });

  const makeDepositOrder = (planPatch: Record<string, any> = {}, extra: Record<string, any> = {}) => {
    const plan = { ...buildPaymentPlan(String(tailorId), 90_000, 50)!, status: 'deposit_paid', ...planPatch };
    return orderModel.create({
      customer: customerId,
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      type: 'bespoke',
      status: 'processing',
      payment_status: 'paid',
      items: [{ business: tailorId, total_price: plan.deposit_amount }],
      total: plan.deposit_amount,
      subtotal: plan.deposit_amount,
      payment_plan: plan,
      shipments: [
        {
          business: tailorId,
          shipment_type: 'vendor_to_customer',
          status: 'pending',
          confirmed: true,
          fulfillment_deadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
          production_steps: [{ key: 'sewing', completed: true, completed_at: new Date() }],
        },
      ],
      ...extra,
    });
  };

  it('photos ask for the balance; approving without paying is refused; shipping is blocked', async () => {
    const order = await makeDepositOrder();
    await orders.submitPreship(order.reference, tailorId.toString(), {
      photos: ['https://cdn/finished.jpg'],
    });
    let saved = await orderModel.findById(order._id).lean();
    expect(saved.payment_plan.status).toBe('awaiting_balance');
    expect(saved.payment_plan.balance_due_at).toBeTruthy();
    expect(notify.mock.calls[0][0].body).toMatch(/₦45,000 balance/);

    await expect(
      orders.reviewPreship(order.reference, customerId.toString(), { approve: true }),
    ).rejects.toThrow(/Pay the ₦45,000 balance/);

    await expect(
      orders.markProductionReadyToShip(order.reference, tailorId.toString()),
    ).rejects.toThrow(/pay the ₦45,000 balance/i);

    // A change request pauses the balance clock.
    await orders.reviewPreship(order.reference, customerId.toString(), {
      approve: false,
      note: 'Shorten the sleeves',
    });
    saved = await orderModel.findById(order._id).lean();
    expect(saved.payment_plan.balance_due_at).toBeNull();
  });

  it('paying the balance raises the order to the full price, once, and lets the tailor ship', async () => {
    const order = await makeDepositOrder({ status: 'awaiting_balance' }, {
      preship: { photos: ['x'], status: 'pending_review', submitted_at: new Date() },
    });
    expect(await business.settleBespokeBalance(order._id, 'PAY-BAL')).toBe(true);
    expect(await business.settleBespokeBalance(order._id, 'PAY-BAL-2')).toBe(false);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.total).toBe(90_000);
    expect(saved.items[0].total_price).toBe(90_000);
    expect(saved.payment_plan.status).toBe('paid');
    expect(saved.payment_plan.balance_reference).toBe('PAY-BAL');
    expect(saved.preship.status).toBe('approved');
    // The overdue deadline moved forward so the tailor isn't "late".
    expect(new Date(saved.shipments[0].fulfillment_deadline).getTime()).toBeGreaterThan(Date.now());

    expect(earnings).toHaveLength(1);
    expect(earnings[0]).toMatchObject({ milestone: 'balance', amount: 45_000, net_amount: 40_500 });
    expect(earnings[0].release_date).toBeInstanceOf(Date);

    await orders.markProductionReadyToShip(order.reference, tailorId.toString());
  });

  it('a balance that arrives after the order closed does not settle', async () => {
    const order = await makeDepositOrder({ status: 'forfeited' }, { status: 'cancelled' });
    expect(await business.settleBespokeBalance(order._id, 'PAY-LATE')).toBe(false);
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.total).toBe(45_000);
  });

  it('cancelling before the photos keeps 30% of the full quote, capped by the deposit', async () => {
    const order = await makeDepositOrder();
    const quote = await orders.quoteCancellation(order, 45_000);
    expect(quote.total).toBe(27_000); // 30% of ₦90,000
    expect(quote.refund).toBe(18_000);
  });

  it('cancelling after the photos keeps the whole deposit', async () => {
    const order = await makeDepositOrder({ status: 'awaiting_balance' });
    const quote = await orders.quoteCancellation(order, 45_000);
    expect(quote.total).toBe(45_000);
    expect(quote.refund).toBe(0);
  });

  it('an unpaid balance past its window closes the order; the tailor keeps the deposit', async () => {
    const order = await makeDepositOrder(
      { status: 'awaiting_balance', balance_due_at: new Date(Date.now() - 1000) },
      { preship: { photos: ['x'], status: 'pending_review', submitted_at: new Date(Date.now() - 15 * 86_400_000) } },
    );
    await orders.runBespokeBalanceTimers();
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('cancelled');
    expect(saved.payment_plan.status).toBe('forfeited');
    expect(saved.cancellation_reconciled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2); // customer + tailor team
  });

  it('a paused clock (changes requested) never closes the order', async () => {
    const order = await makeDepositOrder(
      { status: 'awaiting_balance', balance_due_at: null },
      { preship: { photos: ['x'], status: 'changes_requested', submitted_at: new Date(Date.now() - 30 * 86_400_000) } },
    );
    await orders.runBespokeBalanceTimers();
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('processing');
  });
});
