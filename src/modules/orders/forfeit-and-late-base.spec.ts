import { Types } from 'mongoose';
import { latePenaltyBase, latePreviewFor, lateRulesFrom } from './late-penalty';
import { unusedDeliveryOnForfeit } from './bespoke-payment-plan';
import { OrderService } from './orders.service';

/**
 * Two money rules from the staging review (13 Nov 2026):
 * - a bespoke order closed for an unpaid balance refunds the delivery that
 *   never happened (the tailor still keeps the deposit);
 * - a late bespoke tailor is charged a percentage of the quote, not of the
 *   deposit (BUG-16).
 */

const tailor = new Types.ObjectId().toString();
const fabricShop = new Types.ObjectId().toString();

const bespoke = (planStatus: string, o: any = {}) => ({
  _id: new Types.ObjectId(),
  reference: 'BSP-42',
  customer: new Types.ObjectId(),
  status: 'processing',
  items: [{ _id: new Types.ObjectId(), business: new Types.ObjectId(tailor), total_price: 50_000 }],
  payment_plan: {
    kind: 'deposit',
    tailor,
    quote_total: 100_000,
    deposit_amount: 50_000,
    balance_amount: 50_000,
    status: planStatus,
    balance_due_at: new Date(Date.now() - 1000),
  },
  shipments: [
    {
      business: new Types.ObjectId(tailor),
      shipment_type: 'vendor_to_customer',
      status: 'pending',
      confirmed: true,
      shipping_fee: 4_500,
      fulfillment_deadline: new Date(Date.now() - 3 * 86_400_000),
    },
    {
      business: new Types.ObjectId(fabricShop),
      destination_business: new Types.ObjectId(tailor),
      shipment_type: 'fabric_transfer',
      status: 'delivered',
      confirmed: true,
      shipping_fee: 2_000,
    },
  ],
  ...o,
});

describe('late charge on a bespoke order (BUG-16)', () => {
  it('counts the unpaid balance: 5% of the ₦100,000 quote, not of the deposit', () => {
    expect(latePenaltyBase(bespoke('deposit_paid'), tailor)).toBe(100_000);
    const rules = lateRulesFrom({});
    const o: any = bespoke('deposit_paid');
    o.shipments = o.shipments.slice(0, 1);
    expect(latePreviewFor(o, o.shipments[0], rules)?.per_day).toBe(5_000);
  });

  it('once the balance is paid the item already holds it: no double count', () => {
    const o = bespoke('paid');
    o.items[0].total_price = 100_000;
    expect(latePenaltyBase(o, tailor)).toBe(100_000);
  });

  it('only the tailor’s base grows, and not once their item was rejected', () => {
    expect(latePenaltyBase(bespoke('deposit_paid'), fabricShop)).toBe(0);
    const o = bespoke('deposit_paid');
    (o.items[0] as any).rejected = true;
    expect(latePenaltyBase(o, tailor)).toBe(0);
  });
});

describe('balance never paid: delivery that never happened is refunded', () => {
  it('the outfit’s delivery is unused; the fabric already couriered is kept', () => {
    expect(unusedDeliveryOnForfeit(bespoke('awaiting_balance'))).toBe(4_500);
  });

  const setup = (refundOk = true) => {
    const service: any = Object.create(OrderService.prototype);
    const create = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const processPartialRefund = jest.fn().mockResolvedValue({ success: refundOk });
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      orderModel: { updateOne, db: { models: {} } },
      notificationsService: { create },
      vendorRecipients: { resolve: async () => [] },
      processPartialRefund,
    });
    return { service, create, updateOne, processPartialRefund };
  };

  it('refunds it, takes it off the order, and tells the customer', async () => {
    const { service, create, updateOne, processPartialRefund } = setup();
    const order = bespoke('awaiting_balance');
    await service.forfeitBespokeBalance(order, new Date());
    expect(processPartialRefund).toHaveBeenCalledWith(order, 4_500, expect.stringMatching(/Delivery not used/));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: order._id },
      { $set: { refund_status: 'partial' }, $inc: { shipping_fee: -4_500, total: -4_500 } },
    );
    const notice = create.mock.calls[0][0];
    expect(notice.body).toMatch(/deposit covers the tailor's work/);
    expect(notice.body).toMatch(/₦4,500 you paid for delivery has been refunded/);
  });

  it('a failed refund is not announced as made', async () => {
    const { service, create } = setup(false);
    await service.forfeitBespokeBalance(bespoke('awaiting_balance'), new Date());
    expect(create.mock.calls[0][0].body).not.toMatch(/refunded/);
  });
});
