import { Types } from 'mongoose';
import { ReturnsService } from './returns.service';
import { ReturnSchema, ReturnStatus } from './schemas/return.schema';
import { OrderSchema } from '../orders/schemas/orders.schema';
import { BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * The refund a completed return issues. It used to go through the gateway
 * refund helper, which refunds the WHOLE original charge - so returning one
 * ₦5,000 item on a ₦28,000 multi-vendor card order sent the customer
 * ₦28,000 while only this vendor's ₦5,000 earning was reversed. Now the
 * returned items' value goes to the customer's wallet, and the released
 * earnings are clawed back through the wallet reconcile (which carries any
 * shortfall as owed).
 */
describe('ReturnsService.markReceived - refund', () => {
  const mongo = new MemoryMongo();
  let returnModel: any;
  let orderModel: any;
  let earningsModel: any;
  let service: any;
  let refundToCustomerWallet: jest.Mock;
  let reconcileBusinessWallet: jest.Mock;

  const customer = new Types.ObjectId();
  const vendorA = new Types.ObjectId();
  const vendorB = new Types.ObjectId();
  const productA = new Types.ObjectId();
  const productB = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    returnModel = mongo.model('Return', ReturnSchema);
    orderModel = mongo.model('Order', OrderSchema);
    earningsModel = mongo.model('BusinessEarning', BusinessEarningSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([returnModel.deleteMany({}), orderModel.deleteMany({}), earningsModel.deleteMany({})]);
    refundToCustomerWallet = jest.fn().mockResolvedValue({ walletId: 'w' });
    reconcileBusinessWallet = jest.fn().mockResolvedValue({});
    service = Object.create(ReturnsService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      returnModel,
      orderModel,
      businessEarningsModel: earningsModel,
      businessModel: { findById: jest.fn().mockResolvedValue({ business_name: 'Ada Wears' }) },
      productService: { restoreInventory: jest.fn().mockResolvedValue({}) },
      recEventModel: { insertMany: jest.fn().mockResolvedValue([]) },
      notificationsService: { create: jest.fn().mockResolvedValue({}) },
      vendorRecipients: { resolve: jest.fn().mockResolvedValue([]) },
      transactionService: { findByOrderId: jest.fn().mockResolvedValue({ channel: 'checkout', reference: 'PSK-1' }) },
      walletsService: { refundToCustomerWallet, reconcileBusinessWallet },
    });
  });

  const seed = async () => {
    const order = await orderModel.create({
      customer,
      reference: 'QLZ-RET1',
      status: 'completed',
      payment_status: 'paid',
      items: [
        { product: productA, business: vendorA, total_price: 5_000 },
        { product: productB, business: vendorB, total_price: 20_000 },
      ],
      subtotal: 25_000,
      shipping_fee: 3_000,
      total: 28_000,
      inventory_deducted: true,
    });
    const ret = await returnModel.create({
      order: order._id,
      order_reference: order.reference,
      customer,
      business: vendorA,
      items: [productA],
      reason: 'wrong_size',
      status: ReturnStatus.VENDOR_APPROVED,
    });
    return { order, ret };
  };

  it('refunds the returned items only, to the wallet, whatever the payment channel', async () => {
    const { order, ret } = await seed();

    await service.markReceived(ret._id.toString(), vendorA.toString());

    expect(refundToCustomerWallet).toHaveBeenCalledTimes(1);
    expect(refundToCustomerWallet.mock.calls[0][0]).toMatchObject({ amount: 5_000, reason: 'return_refund' });
    expect(refundToCustomerWallet.mock.calls[0][0].order._id.toString()).toBe(order._id.toString());
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.refund_status).toBe('partial');
    const savedRet = await returnModel.findById(ret._id).lean();
    expect(savedRet.status).toBe(ReturnStatus.REFUND_PROCESSED);
    expect(savedRet.refund_amount).toBe(5_000);
  });

  it('claws back only this vendor: released earnings from the balance, pending ones deleted', async () => {
    const { order, ret } = await seed();
    await earningsModel.create({ business: vendorA, order: order._id, amount: 5_000, commission: 500, net_amount: 4_500, released: true });
    await earningsModel.create({ business: vendorB, order: order._id, amount: 20_000, commission: 2_000, net_amount: 18_000, released: false });

    await service.markReceived(ret._id.toString(), vendorA.toString());

    expect(reconcileBusinessWallet).toHaveBeenCalledTimes(1);
    expect(reconcileBusinessWallet.mock.calls[0][0].toString()).toBe(vendorA.toString());
    expect(reconcileBusinessWallet.mock.calls[0][1]).toEqual({ balance: -4_500 });
    const a = await earningsModel.findOne({ business: vendorA }).lean();
    expect(a.net_amount).toBe(0);
    // The other vendor's earning is untouched.
    const b = await earningsModel.findOne({ business: vendorB }).lean();
    expect(b.net_amount).toBe(18_000);
  });

  it('takes back only the returned item when the vendor sold several', async () => {
    const productC = new Types.ObjectId();
    const order = await orderModel.create({
      customer,
      reference: 'QLZ-RET2',
      status: 'completed',
      payment_status: 'paid',
      items: [
        { product: productA, business: vendorA, total_price: 5_000 },
        { product: productC, business: vendorA, total_price: 15_000 },
      ],
      subtotal: 20_000,
      total: 20_000,
      inventory_deducted: true,
    });
    const [lineA, lineC] = order.items;
    // Item-linked earnings: only line A's goes.
    await earningsModel.create({ business: vendorA, order: order._id, item: lineA._id, amount: 5_000, commission: 500, net_amount: 4_500, released: false });
    await earningsModel.create({ business: vendorA, order: order._id, item: lineC._id, amount: 15_000, commission: 1_500, net_amount: 13_500, released: false });
    const ret = await returnModel.create({
      order: order._id, order_reference: order.reference, customer, business: vendorA,
      items: [productA], reason: 'wrong_size', status: ReturnStatus.VENDOR_APPROVED,
    });

    await service.markReceived(ret._id.toString(), vendorA.toString());

    const left = await earningsModel.find({ business: vendorA }).lean();
    expect(left).toHaveLength(1);
    expect(String(left[0].item)).toBe(String(lineC._id));
    expect(reconcileBusinessWallet.mock.calls[0][1]).toEqual({ pending: -4_500 });
    // Only the returned line goes back in stock.
    expect(service.productService.restoreInventory).toHaveBeenCalledTimes(1);
    expect(String(service.productService.restoreInventory.mock.calls[0][2])).toBe(String(lineA._id));
  });

  it('takes the returned share of a legacy earning with no item link', async () => {
    const productC = new Types.ObjectId();
    const order = await orderModel.create({
      customer, reference: 'QLZ-RET3', status: 'completed', payment_status: 'paid',
      items: [
        { product: productA, business: vendorA, total_price: 5_000 },
        { product: productC, business: vendorA, total_price: 15_000 },
      ],
      subtotal: 20_000, total: 20_000, inventory_deducted: true,
    });
    await earningsModel.create({ business: vendorA, order: order._id, amount: 20_000, commission: 2_000, net_amount: 18_000, released: true });
    const ret = await returnModel.create({
      order: order._id, order_reference: order.reference, customer, business: vendorA,
      items: [productA], reason: 'wrong_size', status: ReturnStatus.VENDOR_APPROVED,
    });

    await service.markReceived(ret._id.toString(), vendorA.toString());

    // 5,000 of 20,000 returned: a quarter of the 18,000 net.
    expect(reconcileBusinessWallet.mock.calls[0][1]).toEqual({ balance: -4_500 });
    const e = await earningsModel.findOne({ business: vendorA }).lean();
    expect(e.net_amount).toBe(13_500);
  });
});

describe('ReturnsService - requests, rejection and auto-approval', () => {
  const mongo = new MemoryMongo();
  let returnModel: any;
  let orderModel: any;
  let earningsModel: any;
  let service: any;
  let notices: string[];
  const customer = new Types.ObjectId();
  const vendor = new Types.ObjectId();
  const product = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    returnModel = mongo.model('Return', ReturnSchema);
    orderModel = mongo.model('Order', OrderSchema);
    earningsModel = mongo.model('BusinessEarning', BusinessEarningSchema);
  }, 120_000);
  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([returnModel.deleteMany({}), orderModel.deleteMany({}), earningsModel.deleteMany({})]);
    notices = [];
    service = Object.create(ReturnsService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      returnModel,
      orderModel,
      businessEarningsModel: earningsModel,
      platformSettingsModel: {
        findOne: () => ({
          lean: async () => ({ return_window_days: 7, payout_delay_days: 3, return_auto_approve_days: 3 }),
        }),
      },
      notificationsService: {
        create: jest.fn(async (n: any) => {
          notices.push(n.title);
        }),
      },
      vendorRecipients: { resolve: jest.fn().mockResolvedValue([{ userId: 'u1' }]) },
    });
  });

  let seq = 0;
  const delivered = (clothingType?: string) => {
    seq += 1;
    return orderModel.create({
      customer,
      reference: 'QLZ-REQ' + seq,
      status: 'completed',
      payment_status: 'paid',
      items: [{ product, business: vendor, total_price: 9_000, ...(clothingType ? { clothing_type: clothingType } : {}) }],
      shipments: [{ business: vendor, status: 'delivered', delivered_at: new Date() }],
      subtotal: 9_000,
      total: 9_000,
    });
  };

  it('refuses a return on a piece made to measure', async () => {
    const order = await delivered('customize');
    await expect(
      service.requestReturn(customer.toString(), {
        order_reference: order.reference,
        business_id: vendor.toString(),
        item_ids: [product.toString()],
        reason: 'wrong_size',
      }),
    ).rejects.toThrow(/made to your measurements/);
  });

  it('needs a reason to reject, and holds the payout long enough to dispute', async () => {
    const order = await delivered();
    await earningsModel.create({ business: vendor, order: order._id, amount: 9_000, commission: 900, net_amount: 8_100, released: false, release_date: null });
    const ret = await returnModel.create({
      order: order._id, order_reference: order.reference, customer, business: vendor,
      items: [product], reason: 'wrong_size', status: ReturnStatus.REQUESTED,
    });

    await expect(service.rejectReturn(ret._id.toString(), vendor.toString(), ' ')).rejects.toThrow(/why/);

    await service.rejectReturn(ret._id.toString(), vendor.toString(), 'Worn and washed');
    const e = await earningsModel.findOne({ order: order._id }).lean();
    // Not now: at least three days out, so the customer can still dispute.
    expect(new Date(e.release_date).getTime()).toBeGreaterThan(Date.now() + 2.9 * 86400000);
  });

  it('approves a return left unanswered past the setting, once', async () => {
    const order = await delivered();
    const old = await returnModel.create({
      order: order._id, order_reference: order.reference, customer, business: vendor,
      items: [product], reason: 'wrong_size', status: ReturnStatus.REQUESTED,
    });
    await returnModel.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 4 * 86400000) } },
    );
    const fresh = await returnModel.create({
      order: order._id, order_reference: 'QLZ-FRESH', customer, business: vendor,
      items: [product], reason: 'wrong_size', status: ReturnStatus.REQUESTED,
    });

    await service.autoApproveStaleReturns();
    await service.autoApproveStaleReturns();

    const a = await returnModel.findById(old._id).lean();
    const b = await returnModel.findById(fresh._id).lean();
    expect(a.status).toBe(ReturnStatus.VENDOR_APPROVED);
    expect(a.auto_approved).toBe(true);
    expect(b.status).toBe(ReturnStatus.REQUESTED);
    expect(notices.filter((t) => t === 'Return approved automatically')).toHaveLength(1);
  });
});
