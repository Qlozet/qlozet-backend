import { Types } from 'mongoose';
import {
  applyFabricLine,
  fabricDepositFloor,
  fabricOnTop,
  priceQuoteFabric,
  quoteFabrics,
} from './quote-fabric';
import { buildPaymentPlan } from '../orders/bespoke-payment-plan';

const tailor = String(new Types.ObjectId());
const other = String(new Types.ObjectId());
const fabricProduct = (business: string, fabric: any) => ({
  _id: new Types.ObjectId(),
  business,
  fabric: { name: 'Ankara', yard_length: 20, ...fabric },
});

describe('bespoke quote fabric pricing', () => {
  it("prices another vendor's fabric on top of the quote", () => {
    const p = priceQuoteFabric({
      fabricProduct: fabricProduct(other, { price_per_yard: 3000 }),
      tailorId: tailor,
      yards: 4,
      supplierName: 'Fabric House',
    });
    expect(p).toMatchObject({
      source: 'other_vendor',
      amount: 12000,
      yards: 4,
      in_quote: false,
      supplier_name: 'Fabric House',
    });
    // A Fabric line typed by the tailor is dropped: never billed twice.
    expect(
      applyFabricLine(
        [
          { label: 'Base Tailoring', amount: 20000 },
          { label: 'Fabric', amount: 5000 },
        ],
        p,
      ),
    ).toEqual([{ label: 'Base Tailoring', amount: 20000 }]);
    expect(fabricDepositFloor(p)).toBe(0);
  });

  it('rounds piece-only fabric up to whole pieces', () => {
    const p = priceQuoteFabric({
      fabricProduct: fabricProduct(other, {
        sold_by: 'piece',
        piece_yards: 6,
        piece_price: 15000,
        price_per_yard: 2500,
      }),
      tailorId: tailor,
      yards: 7,
    });
    expect(p).toMatchObject({ yards: 12, pieces: 2, amount: 30000 });
  });

  it("prices the tailor's own fabric from their listing, inside the quote", () => {
    const p = priceQuoteFabric({
      fabricProduct: fabricProduct(tailor, { price_per_yard: 2000 }),
      tailorId: tailor,
      yards: 5,
      lineItems: [{ label: 'Fabric', amount: 0 }],
    });
    expect(p).toMatchObject({ source: 'tailor_stock', amount: 10000, in_quote: true });
    expect(
      applyFabricLine(
        [
          { label: 'Base Tailoring', amount: 20000 },
          { label: 'Fabric', amount: 0 },
          { label: 'Add-ons', amount: 1000 },
        ],
        p,
      ),
    ).toEqual([
      { label: 'Base Tailoring', amount: 20000 },
      { label: 'Fabric', amount: 10000 },
      { label: 'Add-ons', amount: 1000 },
    ]);
  });

  it('takes the typed cost when the tailor sources the fabric', () => {
    const p = priceQuoteFabric({
      fabricProduct: null,
      tailorId: tailor,
      lineItems: [
        { label: 'Base Tailoring', amount: 30000 },
        { label: 'fabric', amount: 45000 },
      ],
    });
    expect(p).toMatchObject({ source: 'tailor_sourced', amount: 45000, in_quote: true, yards: null });
    expect(fabricDepositFloor(p)).toBe(45000);
  });
});

describe('deposit floor', () => {
  it('uses the percentage when it covers the fabric', () => {
    const plan = buildPaymentPlan(tailor, 80000, 50, 20000)!;
    expect(plan.deposit_amount).toBe(40000);
    expect(plan.deposit_covers_fabric).toBe(false);
  });

  it('raises the deposit to the fabric when the fabric costs more', () => {
    const plan = buildPaymentPlan(tailor, 80000, 50, 60000)!;
    expect(plan.deposit_amount).toBe(60000);
    expect(plan.balance_amount).toBe(20000);
    expect(plan.deposit_covers_fabric).toBe(true);
  });

  it('charges in full when the fabric is the whole quote', () => {
    expect(buildPaymentPlan(tailor, 50000, 50, 50000)).toBeNull();
  });
});

describe('a garment with more than one fabric', () => {
  const lines = [
    { label: 'Tailoring', amount: 40000 },
    { label: 'Fabric', amount: 9000 },
    { label: 'Fabric (Lining)', amount: 6000 },
  ];

  it('reads each fabric the tailor sources from its own line', () => {
    const main = priceQuoteFabric({ fabricProduct: null, tailorId: tailor, lineItems: lines });
    const lining = priceQuoteFabric({ fabricProduct: null, tailorId: tailor, lineItems: lines, role: 'lining' });
    expect(main).toMatchObject({ role: 'main', amount: 9000, in_quote: true });
    expect(lining).toMatchObject({ role: 'lining', amount: 6000, in_quote: true });
  });

  it('gives each fabric inside the quote its own line, and drops one billed on top', () => {
    const contrast = priceQuoteFabric({
      fabricProduct: fabricProduct(tailor, { price_per_yard: 3000 }),
      tailorId: tailor,
      yards: 2,
      lineItems: lines,
      role: 'contrast',
    });
    const lining = priceQuoteFabric({
      fabricProduct: fabricProduct(other, { price_per_yard: 2500 }),
      tailorId: tailor,
      yards: 3,
      lineItems: lines,
      role: 'lining',
    });
    const out = [contrast, lining].reduce((l, f) => applyFabricLine(l, f), lines);
    expect(out).toEqual([
      { label: 'Tailoring', amount: 40000 },
      { label: 'Fabric', amount: 9000 },
      { label: 'Fabric (Contrast)', amount: 6000 },
    ]);
    expect(fabricOnTop([contrast, lining])).toBe(7500);
  });

  it('every fabric inside the quote counts toward the deposit floor', () => {
    const quote = {
      fabric_pricing: { source: 'tailor_stock', amount: 9000, in_quote: true },
      extra_fabric_pricing: [
        { role: 'lining', source: 'tailor_sourced', amount: 6000, in_quote: true },
        { role: 'contrast', source: 'other_vendor', amount: 7500, in_quote: false },
      ],
    };
    expect(quoteFabrics(quote)).toHaveLength(3);
    expect(fabricDepositFloor(quoteFabrics(quote))).toBe(15000);
    expect(fabricDepositFloor(quote.fabric_pricing as any)).toBe(9000);
    expect(fabricOnTop(quoteFabrics(quote))).toBe(7500);
  });
});
