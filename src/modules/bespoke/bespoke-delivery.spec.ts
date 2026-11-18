import { Types } from 'mongoose';
import { BespokeService } from './bespoke.service';
import { cheapestCourier, deliveryFromRates, garmentParcel } from './bespoke-delivery';

/**
 * Delivery on a bespoke order (13 Nov 2026): priced from the tailor's shop to
 * the customer's address when they accept the quote, shown before they pay,
 * and charged with the deposit. Until now it was ₦0 and Qlozet paid the
 * courier on every bespoke order.
 */

const rates = {
  request_token: 'tok-1',
  couriers: [
    { courier_id: 11, courier_name: 'Slow Co', service_code: 's1', total: 6_200, delivery_eta: '3-5 days' },
    { courier_id: 12, courier_name: 'Cheap Co', service_code: 's2', total: 4_500, delivery_eta: '2-4 days' },
    { courier_id: 13, courier_name: 'Broken', service_code: 's3', total: 0 },
  ],
};

describe('the delivery price', () => {
  it('takes the cheapest priced courier', () => {
    expect(cheapestCourier(rates).courier_name).toBe('Cheap Co');
    expect(deliveryFromRates(rates)).toMatchObject({
      fee: 4_500,
      courier_id: '12',
      service_code: 's2',
      request_token: 'tok-1',
      unpriced: false,
    });
  });

  it('no courier, no price: ₦0 and marked unpriced', () => {
    expect(deliveryFromRates({ couriers: [] })).toMatchObject({ fee: 0, unpriced: true });
  });

  it('describes one finished garment', () => {
    expect(garmentParcel('Bespoke outfit', 100_000)).toMatchObject({ quantity: 1, unit_weight: 1, unit_amount: 100_000 });
  });
});

const customerId = String(new Types.ObjectId());
const tailor = new Types.ObjectId();

const setup = (opts: { tailorCode?: string | null; addressCode?: string | null; fetchRates?: jest.Mock } = {}) => {
  const quote = {
    _id: new Types.ObjectId(),
    reference: 'QT-1',
    status: 'submitted',
    expires_at: new Date(Date.now() + 86_400_000),
    design: new Types.ObjectId(),
    vendor: tailor,
    total: 100_000,
    estimated_completion_days: 10,
    fabric_pricing: null,
    extra_fabric_pricing: [],
  };
  const address = { _id: new Types.ObjectId(), street: '1 Marina', address_code: opts.addressCode === undefined ? 'ADDR-9' : opts.addressCode };
  const fetchRates = opts.fetchRates ?? jest.fn().mockResolvedValue(rates);
  const saved: any[] = [];
  function OrderModel(this: any, doc: any) {
    Object.assign(this, doc);
    this.save = async () => {
      saved.push(doc);
      throw new Error('stop after the order is built');
    };
  }
  (OrderModel as any).findOne = async () => null;
  (OrderModel as any).exists = async () => null;

  const service: any = Object.create(BespokeService.prototype);
  Object.assign(service, {
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    businessModel: {
      findById: () => ({
        select: () => ({
          lean: async () => ({
            business_name: 'Tunde Tailors',
            status: 'approved',
            address_code: opts.tailorCode === undefined ? 'BIZ-1' : opts.tailorCode,
          }),
        }),
      }),
    },
    quoteModel: {
      findOne: (q: any) => {
        const found = String(q?._id) === String(quote._id) ? quote : null;
        return Object.assign(Promise.resolve(found), { lean: async () => found });
      },
    },
    designModel: { findById: async () => ({ _id: quote.design, reference: 'DSN-1', fabric: null, extra_fabrics: [] }) },
    buildBodyProfileSnapshot: async () => ({ measurements: { chest: 96, waist: 82, hip: 100 } }),
    orderModel: OrderModel,
    addressModel: { findOne: async () => address },
    productModel: { findById: () => ({ lean: async () => null }) },
    platformSettingsModel: { findOne: () => ({ lean: async () => ({ bespoke_deposit_percent: 50 }) }) },
    logistics: { fetchRates },
  });
  return { service, quote, address, fetchRates, saved };
};

describe('shown before paying', () => {
  it('the preview gives the price from the tailor to this address', async () => {
    const { service, quote, fetchRates } = setup();
    const res = await service.quoteDelivery(String(quote._id), customerId);
    expect(res).toMatchObject({ fee: 4_500, courier_name: 'Cheap Co', unpriced: false });
    expect(fetchRates.mock.calls[0][1]).toMatchObject({
      sender_address_code: 'BIZ-1',
      reciever_address_code: 'ADDR-9',
    });
  });

  it('unvalidated addresses or a courier outage: ₦0, never an error', async () => {
    const unvalidated = setup({ addressCode: null });
    expect((await unvalidated.service.quoteDelivery(String(unvalidated.quote._id), customerId)).unpriced).toBe(true);
    const down = setup({ fetchRates: jest.fn().mockRejectedValue(new Error('timeout')) });
    expect(await down.service.quoteDelivery(String(down.quote._id), customerId)).toMatchObject({ fee: 0, unpriced: true });
    const noShop = setup({ tailorCode: null });
    expect((await noShop.service.quoteDelivery(String(noShop.quote._id), customerId)).fee).toBe(0);
  });
});

describe('charged with the deposit', () => {
  it('accepting adds delivery to what is paid now, on the tailor’s shipment', async () => {
    const { service, quote, saved } = setup();
    await expect(service.acceptQuote(String(quote._id), { id: customerId }, 'paystack')).rejects.toThrow(
      'stop after the order is built',
    );
    const order = saved[0];
    // Deposit 50% of ₦100,000, plus ₦4,500 delivery.
    expect(order.payment_plan.deposit_amount).toBe(50_000);
    expect(order.shipping_fee).toBe(4_500);
    expect(order.total).toBe(54_500);
    // The balance is the rest of the quote; delivery is not in it.
    expect(order.payment_plan.balance_amount).toBe(50_000);
    expect(order.shipments[0]).toMatchObject({ shipping_fee: 4_500, courier_id: '12', service_code: 's2' });
  });

  it('the price shown is the price charged (one lookup for both)', async () => {
    const { service, quote, fetchRates } = setup();
    await service.quoteDelivery(String(quote._id), customerId);
    await expect(service.acceptQuote(String(quote._id), { id: customerId }, 'paystack')).rejects.toThrow();
    expect(fetchRates).toHaveBeenCalledTimes(1);
  });

  it('fabric from another shop: its courier to the tailor is charged too', async () => {
    const fabricShop = new Types.ObjectId();
    const fabricProduct = { _id: new Types.ObjectId(), business: fabricShop, fabric: { _id: new Types.ObjectId(), name: 'Gold lace', yard_length: 20 } };
    const fetchRates = jest.fn().mockResolvedValue(rates);
    const { service, quote, saved } = setup({ fetchRates });
    Object.assign(quote, {
      fabric_pricing: { role: 'main', source: 'other_vendor', product: String(fabricProduct._id), name: 'Gold lace', yards: 3, amount: 15_000, in_quote: false },
    });
    service.designModel = {
      findById: async () => ({ _id: quote.design, reference: 'DSN-1', fabric: fabricProduct._id, extra_fabrics: [] }),
    };
    service.productModel = { findById: () => ({ lean: async () => fabricProduct }) };

    const preview = await service.quoteDelivery(String(quote._id), customerId);
    expect(preview).toMatchObject({ garment_fee: 4_500, fabric_fee: 4_500, fee: 9_000 });

    await expect(service.acceptQuote(String(quote._id), { id: customerId }, 'paystack')).rejects.toThrow(
      'stop after the order is built',
    );
    const order = saved[0];
    const leg = order.shipments.find((s: any) => s.shipment_type === 'fabric_transfer');
    expect(leg.shipping_fee).toBe(4_500);
    expect(order.shipping_fee).toBe(9_000);
    // Deposit ₦50,000 + the other shop's fabric ₦15,000 + both couriers.
    expect(order.total).toBe(50_000 + 15_000 + 9_000);
    // One lookup per leg, shared by the preview and the charge.
    expect(fetchRates).toHaveBeenCalledTimes(2);
  });

  it('no price to be had: the order goes ahead with ₦0 delivery', async () => {
    const { service, quote, saved } = setup({ fetchRates: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(service.acceptQuote(String(quote._id), { id: customerId }, 'paystack')).rejects.toThrow(
      'stop after the order is built',
    );
    expect(saved[0].shipping_fee).toBe(0);
    expect(saved[0].total).toBe(50_000);
  });
});
