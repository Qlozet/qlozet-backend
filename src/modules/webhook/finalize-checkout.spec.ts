import { Types } from 'mongoose';
import { WebhookService } from './webhook.service';
import { OrderSchema } from '../orders/schemas/orders.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Payment finalisation flow — the money path with the worst history:
 * refreshing the confirmation page used to flip cancelled orders back to
 * in_review (fixed in d7c23d0). These tests pin that behaviour down against
 * a real Mongo so it cannot regress silently.
 */
describe('WebhookService.finalizeCheckoutOrder', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let service: WebhookService;
  let recordEarnings: jest.Mock;
  let updateInventory: jest.Mock;

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    recordEarnings = jest.fn().mockResolvedValue(undefined);
    updateInventory = jest.fn().mockResolvedValue(undefined);

    // Real model + stubbed collaborators: the service is built without its
    // constructor so only the fields these flows touch need to exist.
    service = Object.create(WebhookService.prototype);
    Object.assign(service as any, {
      logger: stubLogger,
      orderModel,
      businessService: { recordBusinessEarnings: recordEarnings },
      productService: { updateInventory },
      eventModel: { insertMany: jest.fn().mockResolvedValue([]) },
      fabricClaimModel: { updateOne: jest.fn().mockResolvedValue({}) },
      // Token reward reads settings; a missing doc means "reward off".
      platformSettingsModel: { findOne: () => ({ lean: async () => null }) },
      transactionService: {},
      paymentService: {},
      stripeProvider: {},
    });
  });

  const makeOrder = (overrides: Record<string, any> = {}) =>
    orderModel.create({
      customer: new Types.ObjectId(),
      items: [],
      total: 85_000,
      status: 'pending',
      payment_status: 'unpaid',
      subtotal: 85_000,
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    });

  const checkoutTxn = (order: any) => ({
    channel: 'checkout',
    order: { _id: order._id },
  });

  it('first finalisation moves a pending order to in_review and paid', async () => {
    const order = await makeOrder();
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('in_review');
    expect(saved.payment_status).toBe('paid');
    expect(recordEarnings).toHaveBeenCalledTimes(1);
    expect(updateInventory).toHaveBeenCalledTimes(1);
  });

  it('bespoke orders go straight to processing (tailor already committed)', async () => {
    const order = await makeOrder({ type: 'bespoke' });
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('processing');
  });

  it('repeat finalisation (webhook retry / verify refresh) never moves the status again', async () => {
    const order = await makeOrder();
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);

    // Customer ships happen: vendor moves the order on between retries.
    await orderModel.updateOne({ _id: order._id }, { status: 'in_transit' });
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('in_transit');
  });

  it('REGRESSION d7c23d0: re-verify does not resurrect a cancelled order', async () => {
    const order = await makeOrder();
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);
    await orderModel.updateOne({ _id: order._id }, { status: 'cancelled' });

    // The confirmation page is refreshed → the same finalisation runs again.
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('cancelled');
  });

  it('a LATE first webhook still records payment on a cancelled order without reviving it', async () => {
    const order = await makeOrder({ status: 'cancelled' });
    await service.finalizeCheckoutOrder(checkoutTxn(order) as any);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('cancelled');
    // The money WAS taken — it must stay visible for refund handling.
    expect(saved.payment_status).toBe('paid');
  });

  it('ignores non-checkout transactions entirely', async () => {
    const order = await makeOrder();
    await service.finalizeCheckoutOrder({
      channel: 'wallet_checkout',
      order: { _id: order._id },
    } as any);

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.status).toBe('pending');
    expect(recordEarnings).not.toHaveBeenCalled();
  });
});

describe('WebhookService.verifyAndFinalize', () => {
  it('wallet references report their stored status without touching the gateway', async () => {
    const verifyPaystack = jest.fn();
    const service: any = Object.create(WebhookService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      transactionService: {
        findByReference: jest
          .fn()
          .mockResolvedValue({ channel: 'wallet_checkout', status: 'success' }),
      },
      paymentService: { verifyPaystackPayment: verifyPaystack },
    });

    const result = await service.verifyAndFinalize('WALLET-REF-1');
    expect(result).toEqual({ success: true, status: 'success' });
    expect(verifyPaystack).not.toHaveBeenCalled();
  });
});
