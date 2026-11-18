import { PriceCalculationService } from './orders.price-calculation';

/**
 * A store discount on a fabric is charged, not just shown. The listing showed
 * ₦1,800/yd (discounted_price) while checkout charged ₦2,000/yd, because the
 * fabric's own price is worked out from price_per_yard / piece_price and the
 * discount was never applied to it.
 */

const fabricProduct = (over: Record<string, any> = {}) => ({
  _id: 'p1',
  kind: 'fabric',
  base_price: 2_000,
  discounted_price: 1_800,
  fabric: {
    _id: 'f1',
    name: 'Midnight Black Cotton',
    price_per_yard: 2_000,
    min_cut: 1,
    yard_length: 100,
    sold_by: 'both',
    piece_yards: 6,
    piece_price: 12_000,
  },
  ...over,
});

const service = (product: any) => {
  const pricing: any = Object.create(PriceCalculationService.prototype);
  pricing.productModel = { findById: async () => product };
  pricing.discountModel = { findById: () => ({ lean: async () => null }) };
  pricing.logger = { debug: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined };
  return pricing as PriceCalculationService & Record<string, any>;
};

const yards = (n: number) => ({ fabric_selection: [{ fabric_id: 'p1', yardage: n, quantity: 1 }] });
const pieces = (n: number) => ({ fabric_selection: [{ fabric_id: 'p1', pieces: n, yardage: 6, quantity: n }] });

describe('fabric store discount', () => {
  it('charges the sale price per yard', async () => {
    const p = fabricProduct();
    const total = await service(p).calculateFabricTotal({ product_id: 'p1', quantity: 1, selections: yards(3) } as any, p as any);
    expect(total).toBe(5_400);
  });

  it('marks a whole piece down by the same share', async () => {
    const p = fabricProduct();
    const total = await service(p).calculateFabricTotal({ product_id: 'p1', quantity: 1, selections: pieces(1) } as any, p as any);
    expect(total).toBe(10_800);
  });

  it('charges the full price when there is no discount', async () => {
    const p = fabricProduct({ discounted_price: null });
    const total = await service(p).calculateFabricTotal({ product_id: 'p1', quantity: 1, selections: yards(3) } as any, p as any);
    expect(total).toBe(6_000);
  });

  it('ignores a discounted price that is not below the full price', async () => {
    const p = fabricProduct({ discounted_price: 2_500 });
    expect(service(p).fabricSaleRatio(p as any)).toBe(1);
  });

  it('reports the full price and the markdown in the breakdown', async () => {
    const p = fabricProduct();
    const b = await service(p).calculateItemBreakdown({ product_id: 'p1', quantity: 1, selections: yards(3) } as any);
    expect(b).toMatchObject({ before_discount: 6_000, discount: 600, final: 5_400 });
  });
});
