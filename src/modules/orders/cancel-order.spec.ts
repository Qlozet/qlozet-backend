import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Cancel/refund flow. History: the old ordering refunded FIRST and only
 * saved status=cancelled at the end, so a mid-step failure left the order
 * active — sometimes after the wallet was already credited (fixed in
 * 06746b2). These tests pin the cancel-first contract.
 */
describe('OrdersService.cancelOrder', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let earningsModel: any;
  let service: any;
  let creditWallet: jest.Mock;
  let createTxn: jest.Mock;
  let findByOrderId: jest.Mock;

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
    creditWallet = jest.fn().mockResolvedValue(undefined);
    createTxn = jest.fn().mockResolvedValue({});
    findByOrderId = jest.fn();

    service = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      orderModel,
      businessEarningsModel: earningsModel,
      transactionService: { findByOrderId, create: createTxn },
      walletsService: {
        creditWallet,
        getOrCreateWallet: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId() }),
        reconcileBusinessWallet: jest.fn().mockResolvedValue(undefined),
      },
      productService: { restoreInventory: jest.fn().mockResolvedValue({}) },
      // Fire-and-forget vendor notifications are out of scope here.
      notifyVendorsOrderCancelled: jest.fn().mockResolvedValue(undefined),
    });
  });

  const customerId = new Types.ObjectId();

  const makeOrder = (overrides: Record<string, any> = {}) =>
    orderModel.create({
      customer: customerId,
      items: [],
      total: 45_000,
      status: 'in_review',
      payment_status: 'paid',
      subtotal: 45_000,
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    });

  const walletTxn = (walletId = new Types.ObjectId()) => ({
    channel: 'wallet_checkout',
    amount: 45_000,
    wallet: walletId,
    reference: 'TXN-1',
  });

  it('wallet-paid order: cancels, credits the wallet back, records the refund', async () => {
    const order = await makeOrder();
    const wallet = new Types.ObjectId();
    findByOrderId.mockResolvedValue(walletTxn(wallet));

    await service.cancelOrder(order.reference, {
      customerId: customerId.toString(),
    });

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('cancelled');
    expect(saved.refund_status).toBe('refunded');
    expect(creditWallet).toHaveBeenCalledWith(wallet.toString(), 45_000);
    expect(createTxn).toHaveBeenCalledTimes(1);
    expect(createTxn.mock.calls[0][0]).toMatchObject({
      type: expect.anything(),
      amount: 45_000,
      channel: 'refund',
    });
  });

  it('REGRESSION 06746b2: cancellation persists even when the refund step throws', async () => {
    const order = await makeOrder();
    findByOrderId.mockResolvedValue(walletTxn());
    creditWallet.mockRejectedValue(new Error('wallet service down'));

    await expect(
      service.cancelOrder(order.reference, {
        customerId: customerId.toString(),
      }),
    ).resolves.toBeDefined();

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('cancelled');
    // Money did NOT move — refunded must not be claimed.
    expect(saved.refund_status ?? 'none').not.toBe('refunded');
  });

  it('cancels even when no payment transaction can be found (manual refund case)', async () => {
    const order = await makeOrder();
    findByOrderId.mockResolvedValue(null);

    await service.cancelOrder(order.reference, {
      customerId: customerId.toString(),
    });

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('cancelled');
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('rejects cancelling an already-cancelled order', async () => {
    const order = await makeOrder({ status: 'cancelled' });
    await expect(
      service.cancelOrder(order.reference, {
        customerId: customerId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects cancelling once the order has shipped', async () => {
    const order = await makeOrder({ status: 'in_transit' });
    await expect(
      service.cancelOrder(order.reference, {
        customerId: customerId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('in_transit');
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it("rejects a customer cancelling someone else's order", async () => {
    const order = await makeOrder();
    await expect(
      service.cancelOrder(order.reference, {
        customerId: new Types.ObjectId().toString(),
      }),
    ).rejects.toBeDefined();

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('in_review');
  });
});
