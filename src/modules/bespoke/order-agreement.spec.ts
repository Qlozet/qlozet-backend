import { Types } from 'mongoose';
import {
  DESIGN_REFERENCE_NOTE,
  INCLUDED_CHANGE_ROUNDS,
  buildOrderAgreement,
  type AgreementInput,
} from './order-agreement';
import { BespokeService } from './bespoke.service';
import { OrderService } from '../orders/orders.service';

/**
 * The bespoke order agreement (bespoke review, 13 Nov 2026): one record of
 * the design, fabrics, measurements, price and terms in naira, frozen when
 * the deposit is paid; the tailor agrees when quoting, the customer ticks
 * "I agree" before paying.
 */

const tailor = new Types.ObjectId();
const baseQuote = () => ({
  _id: new Types.ObjectId(),
  vendor: tailor,
  total: 100_000,
  estimated_completion_days: 14,
  line_items: [
    { label: 'Base Tailoring', amount: 60_000 },
    { label: 'Fabric', amount: 30_000 },
    { label: 'Add-ons', amount: 10_000 },
    { label: 'Accessories', amount: 0 },
  ],
  fabric_pricing: { role: 'main', source: 'tailor_stock', name: 'Aso-oke', yards: 4, amount: 30_000, in_quote: true },
  extra_fabric_pricing: [] as any[],
});
const input = (o: Partial<AgreementInput> = {}): AgreementInput => ({
  design: {
    name: 'Wedding agbada',
    reference: 'DSN-7',
    design_images: ['front.png', 'other.png'],
    back_views: [{ front: 'front.png', back: 'back.png' }],
  },
  quote: baseQuote(),
  tailorName: 'Tunde Tailors',
  plan: { deposit_amount: 50_000, balance_amount: 50_000 },
  delivery: { garment: 4_500, fabric: 0 },
  settings: {
    cancellation_fee_percent: 30,
    balance_days: 14,
    late_percent_per_day: 5,
    late_max_percent: 25,
    abandon_after_days: 7,
    dispute_window_days: 30,
    ship_after_balance_days: 3,
  },
  measurements: { set_name: 'Me', unit: 'cm', measurements: { chest: 102, waist: 88, hip: 0 } },
  address: { city: 'Ikeja', state: 'Lagos', street: '1 Secret Close' } as any,
  ...o,
});
const term = (a: any, key: string) => a.terms.find((t: any) => t.key === key)?.text ?? '';

describe('what the agreement holds', () => {
  const a = buildOrderAgreement(input());

  it('the chosen picture and its back, marked as a design reference', () => {
    expect(a.design).toMatchObject({ name: 'Wedding agbada', image: 'front.png', back_image: 'back.png' });
    expect(a.design.note).toBe(DESIGN_REFERENCE_NOTE);
  });

  it('the price split, what is paid now and what is left', () => {
    expect(a.price.line_items.map((l) => l.label)).toEqual(['Base Tailoring', 'Fabric', 'Add-ons']);
    expect(a.price).toMatchObject({
      quote_total: 100_000,
      delivery_to_customer: 4_500,
      total: 104_500,
      pay_now: 54_500,
      remaining_after_photos: 50_000,
    });
  });

  it('measurements with real values only, and the area, never the street', () => {
    expect(a.measurements?.values).toEqual({ chest: 102, waist: 88 });
    expect(a.delivery_area).toBe('Ikeja, Lagos');
    expect(JSON.stringify(a)).not.toContain('Secret Close');
  });

  it('the terms in naira', () => {
    expect(term(a, 'changes')).toMatch(new RegExp(`${INCLUDED_CHANGE_ROUNDS} rounds of changes`));
    expect(term(a, 'cancel')).toMatch(/the tailor keeps ₦30,000 \(30% of the quote\)/);
    expect(term(a, 'cancel')).toMatch(/at least the ₦50,000 deposit/);
    expect(term(a, 'balance')).toMatch(/You pay ₦54,500 now and the remaining ₦50,000/);
    expect(term(a, 'photos_not_final')).toMatch(/within 30 days of delivery/);
    expect(term(a, 'late')).toMatch(/5% of the order, up to 25%/);
    expect(term(a, 'fabric_sent')).toBe('');
  });

  it('fabric from another shop: charged on top, and its own term', () => {
    const q = baseQuote();
    q.fabric_pricing = { role: 'main', source: 'other_vendor', name: 'Gold lace', yards: 3, amount: 15_000, in_quote: false } as any;
    const b = buildOrderAgreement(input({ quote: q, delivery: { garment: 4_500, fabric: 2_000 } }));
    expect(b.fabrics[0]).toMatchObject({ source: 'other_vendor', charged: 'on_top', amount: 15_000 });
    expect(b.price.pay_now).toBe(50_000 + 15_000 + 4_500 + 2_000);
    expect(term(b, 'fabric_sent')).toMatch(/not refunded once it has been sent/);
  });
});

describe('the version', () => {
  it('stays the same for the same order, measurements or not', () => {
    const a = buildOrderAgreement(input());
    const b = buildOrderAgreement(input({ measurements: { measurements: { chest: 90 } } }));
    expect(a.version).toBe(b.version);
  });

  it('changes when the price does', () => {
    const a = buildOrderAgreement(input());
    const b = buildOrderAgreement(input({ delivery: { garment: 5_000, fabric: 0 } }));
    expect(b.version).not.toBe(a.version);
  });
});

describe('agreeing to it', () => {
  const customerId = String(new Types.ObjectId());
  const setup = (q: any) => {
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
    const quote = { ...q, status: 'submitted', expires_at: new Date(Date.now() + 86_400_000), design: new Types.ObjectId(), reference: 'QT-9' };
    const service: any = Object.create(BespokeService.prototype);
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      businessModel: {
        findById: () => ({ select: () => ({ lean: async () => ({ business_name: 'Tunde Tailors', status: 'approved', address_code: 'B1' }) }) }),
      },
      quoteModel: {
        findOne: () => Object.assign(Promise.resolve(quote), { lean: async () => quote }),
      },
      designModel: {
        findById: () =>
          Object.assign(Promise.resolve(input().design), { lean: async () => input().design }),
      },
      buildBodyProfileSnapshot: async () => ({ measurements: { chest: 96, waist: 82, hip: 100 } }),
      orderModel: OrderModel,
      addressModel: { findOne: async () => ({ _id: new Types.ObjectId(), address_code: 'A1', city: 'Ikeja' }) },
      productModel: { findById: () => ({ lean: async () => null }) },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({ bespoke_deposit_percent: 50 }) }) },
      logistics: { fetchRates: jest.fn().mockResolvedValue({ request_token: 't', couriers: [{ courier_id: 1, total: 4_500 }] }) },
    });
    return { service, quote, saved };
  };

  it('the preview is what gets frozen on the order, with the customer’s tick', async () => {
    const { service, quote, saved } = setup({ ...baseQuote(), terms_accepted_at: new Date('2026-11-13T09:00:00Z') });
    const preview = await service.quoteAgreement(String(quote._id), customerId);
    await expect(
      service.acceptQuote(String(quote._id), { id: customerId }, 'paystack', undefined, undefined, preview.version),
    ).rejects.toThrow('stop after the order is built');
    const agreement = saved[0].agreement;
    expect(agreement.version).toBe(preview.version);
    expect(agreement.customer_agreed_at).toBeInstanceOf(Date);
    expect(agreement.tailor_agreed_at).toEqual(new Date('2026-11-13T09:00:00Z'));
    // The order charges what the agreement says is paid now.
    expect(saved[0].total).toBe(agreement.price.pay_now);
  });

  it('a stale agreement is refused before any charge', async () => {
    const { service, quote, saved } = setup(baseQuote());
    await expect(
      service.acceptQuote(String(quote._id), { id: customerId }, 'paystack', undefined, undefined, '2026-11-13/stale'),
    ).rejects.toThrow(/Check the agreement again/);
    expect(saved).toHaveLength(0);
  });

  it('no tick sent (an older app): the order goes ahead, recorded as not agreed', async () => {
    const { service, quote, saved } = setup(baseQuote());
    await expect(service.acceptQuote(String(quote._id), { id: customerId }, 'paystack')).rejects.toThrow(
      'stop after the order is built',
    );
    expect(saved[0].agreement.customer_agreed_at).toBeNull();
    // No tick from the tailor on a quote sent before this existed.
    expect(saved[0].agreement.tailor_agreed_at).toBeNull();
  });
});

describe('changes after the photos', () => {
  const customerId = new Types.ObjectId();
  const svc = (order: any) => {
    const service: any = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      orderModel: { findOne: async () => order },
      vendorRecipients: { resolve: async () => [] },
      notificationsService: { create: jest.fn().mockResolvedValue({}) },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({}) }) },
      resolveProductionShipmentIndex: () => 0,
    });
    return service;
  };
  const order = (preship: any) => ({
    reference: 'ORD-5',
    type: 'bespoke',
    customer: customerId,
    items: [{ business: tailor }],
    preship,
    payment_plan: null,
    markModified: () => undefined,
    save: jest.fn(),
  });

  it(`${INCLUDED_CHANGE_ROUNDS} rounds are included, then the tailor is asked in the chat`, async () => {
    const o: any = order({ status: 'pending_review', photos: ['a'], changes_requested_count: 0 });
    const service = svc(o);
    await service.reviewPreship('ORD-5', String(customerId), { approve: false, note: 'Shorter sleeves' });
    expect(o.preship.changes_requested_count).toBe(1);
    o.preship.status = 'pending_review';
    await service.reviewPreship('ORD-5', String(customerId), { approve: false, note: 'Tighter waist' });
    expect(o.preship.changes_requested_count).toBe(2);
    o.preship.status = 'pending_review';
    await expect(
      service.reviewPreship('ORD-5', String(customerId), { approve: false, note: 'Again' }),
    ).rejects.toThrow(/both have been used/);
    // Approving still works.
    await service.reviewPreship('ORD-5', String(customerId), { approve: true });
    expect(o.preship.status).toBe('approved');
  });

  it('new photos keep the earlier rounds', async () => {
    const o: any = order({
      status: 'changes_requested',
      photos: ['first.jpg'],
      submitted_at: new Date('2026-11-10'),
      customer_note: 'Shorter sleeves',
      changes_requested_count: 1,
    });
    await svc(o).submitPreship('ORD-5', String(tailor), { photos: ['second.jpg'] });
    expect(o.preship.photos).toEqual(['second.jpg']);
    expect(o.preship.changes_requested_count).toBe(1);
    expect(o.preship.history).toHaveLength(1);
    expect(o.preship.history[0]).toMatchObject({ photos: ['first.jpg'], customer_note: 'Shorter sleeves' });
  });
});
