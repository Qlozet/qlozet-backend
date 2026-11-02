import { Types } from 'mongoose';
import { BespokeService } from './bespoke.service';

/**
 * A garment with more than one fabric: the main fabric plus a contrast and a
 * lining. Accepting the quote must turn each into the right order shape:
 * the tailor's own fabric rides on their item (inside the quote), another
 * vendor's fabric is its own paid item with a transfer to the tailor (on top
 * of the quote), and the deposit covers every fabric inside the quote.
 */
describe('accepting a quote for a garment with extra fabrics', () => {
  const customerId = String(new Types.ObjectId());
  const tailor = new Types.ObjectId();
  const fabricShop = new Types.ObjectId();
  const main = { _id: new Types.ObjectId(), business: tailor, fabric: { _id: new Types.ObjectId(), name: 'Aso-oke', yard_length: 20 } };
  const lining = { _id: new Types.ObjectId(), business: tailor, fabric: { _id: new Types.ObjectId(), name: 'Silk lining', yard_length: 10 } };
  const contrast = { _id: new Types.ObjectId(), business: fabricShop, fabric: { _id: new Types.ObjectId(), name: 'Gold lace', yard_length: 5 } };
  const products = new Map([main, lining, contrast].map((p) => [String(p._id), p]));

  const build = (patch: { design?: any; quote?: any } = {}) => {
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

    const design = {
      _id: new Types.ObjectId(),
      reference: 'DSN-1',
      fabric: main._id,
      extra_fabrics: [
        { role: 'lining', fabric: lining._id },
        { role: 'contrast', fabric: contrast._id },
      ],
      ...patch.design,
    };
    const quote = {
      _id: new Types.ObjectId(),
      status: 'submitted',
      expires_at: new Date(Date.now() + 86_400_000),
      design: design._id,
      vendor: tailor,
      total: 100_000,
      estimated_completion_days: 10,
      fabric_pricing: { role: 'main', source: 'tailor_stock', product: String(main._id), yards: 4, amount: 20_000, in_quote: true },
      extra_fabric_pricing: [
        { role: 'lining', source: 'tailor_stock', product: String(lining._id), name: 'Silk lining', yards: 2, amount: 6_000, in_quote: true },
        { role: 'contrast', source: 'other_vendor', product: String(contrast._id), name: 'Gold lace', yards: 1.5, amount: 9_000, in_quote: false },
      ],
      ...patch.quote,
    };

    const service: any = Object.create(BespokeService.prototype);
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      quoteModel: { findOne: async () => quote },
      designModel: { findById: async () => design },
      buildBodyProfileSnapshot: async () => ({ measurements: { chest: 96, waist: 82, hip: 100 } }),
      orderModel: OrderModel,
      addressModel: { findOne: async () => ({ street: '1 Marina' }) },
      productModel: { findById: (id: any) => ({ lean: async () => products.get(String(id)) ?? null }) },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({ bespoke_deposit_percent: 50 }) }) },
    });
    return { service, saved };
  };

  it('puts the tailor’s lining on their item and the other shop’s contrast on its own item and transfer', async () => {
    const { service, saved } = build();
    await expect(service.acceptQuote(String(new Types.ObjectId()), { id: customerId }, 'paystack')).rejects.toThrow(
      'stop after the order is built',
    );
    const order = saved[0];

    const tailorItem = order.items[0];
    expect(tailorItem.fabric_selections).toEqual([
      expect.objectContaining({ fabric_id: String(main.fabric._id), yardage: 4 }),
      expect.objectContaining({ fabric_id: String(lining.fabric._id), product_id: lining._id, yardage: 2 }),
    ]);

    const contrastItem = order.items.find((i: any) => String(i.business) === String(fabricShop));
    expect(contrastItem).toMatchObject({ total_price: 9_000, product: contrast._id });
    expect(contrastItem.fabric_selections[0]).toMatchObject({ fabric_id: String(contrast.fabric._id), yardage: 1.5 });

    const transfer = order.shipments.find((s: any) => s.shipment_type === 'fabric_transfer');
    expect(transfer).toMatchObject({ business: fabricShop, destination_business: tailor, fabric_yards: 1.5 });

    // Deposit 50% of ₦100,000 is ₦50,000, above the ₦26,000 of fabric inside
    // the quote; the other shop's ₦9,000 is paid on top now.
    expect(order.payment_plan.deposit_amount).toBe(50_000);
    expect(order.total).toBe(59_000);
  });

  it('refuses when the design’s extra fabrics changed after the quote', async () => {
    const { service } = build({ design: { extra_fabrics: [{ role: 'lining', fabric: null }] } });
    await expect(service.acceptQuote(String(new Types.ObjectId()), { id: customerId }, 'paystack')).rejects.toThrow(
      "This design's fabrics changed after the quote was sent",
    );
  });

  it('refuses when an extra fabric ran out', async () => {
    const { service } = build({
      quote: {
        extra_fabric_pricing: [
          { role: 'lining', source: 'tailor_stock', product: String(lining._id), name: 'Silk lining', yards: 2, amount: 6_000, in_quote: true },
          { role: 'contrast', source: 'other_vendor', product: String(contrast._id), name: 'Gold lace', yards: 8, amount: 48_000, in_quote: false },
        ],
      },
    });
    await expect(service.acceptQuote(String(new Types.ObjectId()), { id: customerId }, 'paystack')).rejects.toThrow(
      'Gold lace now has only 5 yards left and this quote needs 8',
    );
  });
});
