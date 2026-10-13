import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Abandoned-fulfilment cron. The late penalty stops at its cap and nothing
 * closed a confirmed order the vendor never shipped; this stage cancels the
 * vendor's part N days past the deadline. These tests pin: the window, what
 * is left alone (shipped legs, fresh deadlines, the switched-off setting),
 * the money moves, and that a second pass cannot refund twice.
 */
describe('OrdersService.cancelAbandonedShipments', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let service: any;
  let processPartialRefund: jest.Mock;
  let reverseBusinessEarnings: jest.Mock;
  let restoreInventory: jest.Mock;
  let createNotification: jest.Mock;
  let resolveRecipients: jest.Mock;
  let abandonAfterDays: number | undefined;

  const DAY = 24 * 60 * 60 * 1000;
  const customerId = new Types.ObjectId();
  const vendorA = new Types.ObjectId();
  const vendorB = new Types.ObjectId();
  const ownerUserId = new Types.ObjectId().toString();

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    abandonAfterDays = 7;
    processPartialRefund = jest.fn().mockResolvedValue({ success: true });
    reverseBusinessEarnings = jest.fn().mockResolvedValue(undefined);
    restoreInventory = jest.fn().mockResolvedValue({});
    createNotification = jest.fn().mockResolvedValue({});
    resolveRecipients = jest
      .fn()
      .mockResolvedValue([{ userId: ownerUserId, role: 'owner' }]);

    service = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      orderModel,
      platformSettingsModel: {
        findOne: () => ({
          lean: async () => ({ abandon_after_days: abandonAfterDays }),
        }),
      },
      businessModel: {
        findById: async (id: any) => ({
          _id: id,
          business_name: String(id) === vendorA.toString() ? 'Ada Wears' : 'Bola Bags',
        }),
      },
      productService: { restoreInventory },
      notificationsService: { create: createNotification },
      vendorRecipients: { resolve: resolveRecipients },
      processPartialRefund,
      reverseBusinessEarnings,
    });
  });

  const shipment = (business: Types.ObjectId, overrides: Record<string, any> = {}) => ({
    business,
    confirmed: true,
    confirmed_at: new Date(Date.now() - 12 * DAY),
    status: 'pending',
    shipping_fee: 1_500,
    fulfillment_deadline: new Date(Date.now() - 8 * DAY),
    ...overrides,
  });

  const makeOrder = (overrides: Record<string, any> = {}) =>
    orderModel.create({
      customer: customerId,
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      status: 'processing',
      payment_status: 'paid',
      items: [
        { business: vendorA, total_price: 20_000 },
        { business: vendorB, total_price: 5_000 },
      ],
      subtotal: 25_000,
      shipping_fee: 3_000,
      total: 28_000,
      shipments: [shipment(vendorA), shipment(vendorB)],
      ...overrides,
    });

  it('cancels a confirmed leg N days past its deadline: refund, earnings reversed, stock back, both sides told', async () => {
    const order = await makeOrder({
      shipments: [
        shipment(vendorA),
        shipment(vendorB, { fulfillment_deadline: new Date(Date.now() - 2 * DAY) }),
      ],
    });

    await service.cancelAbandonedShipments();

    const saved = await orderModel.findById(order._id).lean();
    const [a, b] = saved.shipments;
    expect(a.rejected).toBe(true);
    expect(a.refunded).toBe(true);
    expect(a.status).toBe('failed');
    expect(a.rejection_reason).toMatch(/Abandoned.*7 day/);
    // The other vendor is only 2 days late: penalised, not cancelled.
    expect(b.rejected).toBe(false);
    expect(saved.status).toBe('processing');
    // Order totals shrink by the cancelled vendor's items + their shipping.
    expect(saved.subtotal).toBe(5_000);
    expect(saved.shipping_fee).toBe(1_500);
    expect(saved.total).toBe(6_500);

    expect(processPartialRefund).toHaveBeenCalledTimes(1);
    expect(processPartialRefund.mock.calls[0][1]).toBe(21_500);
    expect(reverseBusinessEarnings).toHaveBeenCalledWith(
      expect.anything(),
      vendorA.toString(),
    );
    expect(restoreInventory).toHaveBeenCalledWith(
      expect.anything(),
      vendorA.toString(),
    );

    const toCustomer = createNotification.mock.calls
      .map((c) => c[0])
      .find((n) => n.recipient === customerId.toString());
    expect(toCustomer).toMatchObject({
      type: 'order_cancelled',
      metadata: { reason: 'abandoned_by_vendor', refund_amount: 21_500 },
    });
    expect(toCustomer.body).toContain('Ada Wears');
    expect(toCustomer.body).toContain('refunded');

    expect(resolveRecipients).toHaveBeenCalledWith(vendorA.toString(), expect.any(Array));
    const toVendor = createNotification.mock.calls
      .map((c) => c[0])
      .find((n) => n.recipient === ownerUserId);
    expect(toVendor).toMatchObject({
      type: 'order_cancelled',
      recipient_business: vendorA.toString(),
      metadata: { reason: 'abandoned_by_vendor' },
    });
  });

  it('cancels the whole order when every leg was abandoned', async () => {
    const order = await makeOrder();

    await service.cancelAbandonedShipments();

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.shipments.every((s: any) => s.rejected)).toBe(true);
    expect(saved.status).toBe('cancelled');
    expect(saved.total).toBe(0);
    expect(processPartialRefund).toHaveBeenCalledTimes(2);
  });

  it('tells the customer the refund is still processing when the credit did not land', async () => {
    processPartialRefund.mockResolvedValue({ success: false, reason: 'original_transaction_not_found' });
    await makeOrder({ shipments: [shipment(vendorA)], items: [{ business: vendorA, total_price: 20_000 }] });

    await service.cancelAbandonedShipments();

    const toCustomer = createNotification.mock.calls
      .map((c) => c[0])
      .find((n) => n.recipient === customerId.toString());
    expect(toCustomer.body).toContain('is being processed');
    expect(toCustomer.body).not.toContain('has been refunded');
  });

  it('leaves shipped, unconfirmed and already-rejected legs alone', async () => {
    const order = await makeOrder({
      shipments: [
        shipment(vendorA, { status: 'shipped', shipped_at: new Date() }),
        shipment(vendorB, { confirmed: false }),
      ],
    });
    const rejectedOrder = await makeOrder({
      shipments: [shipment(vendorA, { rejected: true, status: 'failed' })],
      status: 'cancelled',
    });

    await service.cancelAbandonedShipments();

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.shipments[0].rejected).toBe(false);
    expect(saved.shipments[0].status).toBe('shipped');
    expect(saved.shipments[1].rejected).toBe(false);
    const savedRejected = await orderModel.findById(rejectedOrder._id).lean();
    expect(savedRejected.status).toBe('cancelled');
    expect(processPartialRefund).not.toHaveBeenCalled();
  });

  it('does nothing before the window has passed', async () => {
    await makeOrder({
      shipments: [shipment(vendorA, { fulfillment_deadline: new Date(Date.now() - 6.5 * DAY) })],
    });

    await service.cancelAbandonedShipments();

    expect(processPartialRefund).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('a second run (or a second instance) cannot refund the same leg twice', async () => {
    const order = await makeOrder({
      shipments: [shipment(vendorA)],
      items: [{ business: vendorA, total_price: 20_000 }],
      subtotal: 20_000,
      shipping_fee: 1_500,
      total: 21_500,
    });

    // Simulate the overlap: both runs loaded the order before either claimed it.
    const loaded = await orderModel.findById(order._id);
    await service.cancelAbandonedShipments();
    // Second pass with the stale in-memory doc, straight through the claim.
    jest.spyOn(orderModel, 'find').mockResolvedValueOnce([loaded]);
    await service.cancelAbandonedShipments();

    expect(processPartialRefund).toHaveBeenCalledTimes(1);
    expect(reverseBusinessEarnings).toHaveBeenCalledTimes(1);
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.total).toBe(0);
    expect(saved.status).toBe('cancelled');
  });

  it('is switched off by abandon_after_days = 0', async () => {
    abandonAfterDays = 0;
    await makeOrder();

    await service.cancelAbandonedShipments();

    expect(processPartialRefund).not.toHaveBeenCalled();
    const [saved] = await orderModel.find({}).lean();
    expect(saved.shipments.every((s: any) => !s.rejected)).toBe(true);
  });

  it('falls back to 7 days when the setting is missing', async () => {
    abandonAfterDays = undefined;
    await makeOrder({ shipments: [shipment(vendorA)], items: [{ business: vendorA, total_price: 20_000 }] });

    await service.cancelAbandonedShipments();

    expect(processPartialRefund).toHaveBeenCalledTimes(1);
  });
});
