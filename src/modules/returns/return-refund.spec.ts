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
});
