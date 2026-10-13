import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * One-time sweep of cancelled orders. Exists for orders that were paid AFTER
 * being cancelled: earnings recorded, stock deducted, money kept. Each
 * correction is conditional on evidence, so an order cancelled the normal
 * way is flagged and left alone.
 */
describe('OrdersService.reconcileCancelledOrders', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let earningsModel: any;
  let service: any;
  let restoreInventory: jest.Mock;
  let processPartialRefund: jest.Mock;
  let hasSuccessfulRefund: jest.Mock;
  let reconcileWallet: jest.Mock;
  let notify: jest.Mock;

  const customerId = new Types.ObjectId();
  const vendor = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
    earningsModel = mongo.model('BusinessEarning', BusinessEarningSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    await earningsModel.deleteMany({});
    restoreInventory = jest.fn().mockResolvedValue({});
    processPartialRefund = jest.fn().mockResolvedValue({ success: true });
    hasSuccessfulRefund = jest.fn().mockResolvedValue(false);
    reconcileWallet = jest.fn().mockResolvedValue(undefined);
    notify = jest.fn().mockResolvedValue({});

    service = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      orderModel,
      businessEarningsModel: earningsModel,
      productService: { restoreInventory },
      transactionService: { hasSuccessfulRefund, create: jest.fn().mockResolvedValue({}) },
      walletsService: { reconcileBusinessWallet: reconcileWallet },
      notificationsService: { create: notify },
      processPartialRefund,
    });
  });

  const makeOrder = (overrides: Record<string, any> = {}) =>
    orderModel.create({
      customer: customerId,
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      status: 'cancelled',
      payment_status: 'paid',
      items: [{ business: vendor, total_price: 12_000 }],
      subtotal: 12_000,
      total: 12_000,
      inventory_deducted: true,
      ...overrides,
    });

  const holdEarnings = (order: any, net = 10_800) =>
    earningsModel.create({
      business: vendor,
      order: order._id,
      amount: 12_000,
      commission: 1_200,
      net_amount: net,
      released: false,
      milestone: 'completion',
    });

  it('paid-after-cancel: reverses the held earnings, restores stock and refunds the customer', async () => {
    const order = await makeOrder();
    await holdEarnings(order);

    await service.reconcileCancelledOrders();

    expect(await earningsModel.countDocuments({ order: order._id })).toBe(0);
    expect(reconcileWallet).toHaveBeenCalledWith(vendor, { pending: -10_800 });
    expect(restoreInventory).toHaveBeenCalledTimes(1);
    expect(processPartialRefund).toHaveBeenCalledTimes(1);
    expect(processPartialRefund.mock.calls[0][1]).toBe(12_000);
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.refund_status).toBe('refunded');
    expect(saved.cancellation_reconciled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('an order cancelled the normal way is flagged and otherwise untouched', async () => {
    // Earnings already reversed at cancel time, refund already recorded.
    const order = await makeOrder({ refund_status: 'refunded' });
    hasSuccessfulRefund.mockResolvedValue(true);

    await service.reconcileCancelledOrders();

    expect(restoreInventory).not.toHaveBeenCalled();
    expect(processPartialRefund).not.toHaveBeenCalled();
    expect(reconcileWallet).not.toHaveBeenCalled();
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.cancellation_reconciled).toBe(true);
  });

  it('never restores stock on the strength of the deducted flag alone', async () => {
    // Cancel-time restore already ran; the flag is never cleared by it. Only
    // surviving earnings rows prove the deduction happened after the cancel.
    await makeOrder({ inventory_deducted: true });
    hasSuccessfulRefund.mockResolvedValue(true);

    await service.reconcileCancelledOrders();

    expect(restoreInventory).not.toHaveBeenCalled();
  });

  it('does not refund an unpaid cancelled order, but still clears stray earnings', async () => {
    const order = await makeOrder({ payment_status: 'unpaid', inventory_deducted: false });
    await holdEarnings(order);

    await service.reconcileCancelledOrders();

    expect(processPartialRefund).not.toHaveBeenCalled();
    expect(restoreInventory).not.toHaveBeenCalled();
    expect(await earningsModel.countDocuments({ order: order._id })).toBe(0);
  });

  it('leaves a failed refund claimable so the next run retries it', async () => {
    const order = await makeOrder();
    processPartialRefund.mockResolvedValue({ success: false, reason: 'original_transaction_not_found' });

    await service.reconcileCancelledOrders();
    let saved = await orderModel.findById(order._id).lean();
    expect(saved.cancellation_reconciled).toBe(false);
    expect(saved.refund_status ?? 'none').not.toBe('refunded');

    processPartialRefund.mockResolvedValue({ success: true });
    await service.reconcileCancelledOrders();
    saved = await orderModel.findById(order._id).lean();
    expect(saved.cancellation_reconciled).toBe(true);
    expect(saved.refund_status).toBe('refunded');
    expect(processPartialRefund).toHaveBeenCalledTimes(2);
  });

  it('sweeps each order once: a second run touches nothing', async () => {
    const order = await makeOrder();
    await holdEarnings(order);

    await service.reconcileCancelledOrders();
    await service.reconcileCancelledOrders();

    expect(processPartialRefund).toHaveBeenCalledTimes(1);
    expect(restoreInventory).toHaveBeenCalledTimes(1);
  });

  it('ignores orders that are not cancelled', async () => {
    const order = await makeOrder({ status: 'processing' });
    await holdEarnings(order);

    await service.reconcileCancelledOrders();

    expect(await earningsModel.countDocuments({ order: order._id })).toBe(1);
    expect(processPartialRefund).not.toHaveBeenCalled();
  });
});
