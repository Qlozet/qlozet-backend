import { Types } from 'mongoose';
import {
  defaultStylesByPart,
  defaultStylesPrice,
  keepOneDefaultPerPart,
  usesDefaultStyles,
  withDefaultStyles,
} from './style-defaults';
import { PriceCalculationService } from '../orders/orders.price-calculation';

const id = () => new Types.ObjectId();
const style = (type: string, price: number, extra: any = {}) => ({
  _id: id(),
  name: `${type} ${price}`,
  type,
  price,
  ...extra,
});

describe('default styles on made-to-order clothing', () => {
  const vNeck = style('neckline', 2000);
  const roundNeck = style('neckline', 0);
  const longSleeve = style('sleeve', 3000);
  const shortSleeve = style('sleeve', 1500, { is_default: true });
  const styles = [vNeck, roundNeck, longSleeve, shortSleeve];

  it("takes the vendor's pick, else the cheapest of the part", () => {
    const d = defaultStylesByPart(styles);
    expect(d.get('neckline')).toBe(roundNeck);
    expect(d.get('sleeve')).toBe(shortSleeve);
    expect(defaultStylesPrice(styles)).toBe(1500);
  });

  it("reads the part from a library style's categories, not its top/bottom type", () => {
    const neck = { _id: id(), type: 'top', categories: ['neckline'], price: 0 };
    const sleeve = { _id: id(), type: 'top', categories: ['sleeve'], price: 900 };
    const own = { _id: id(), type: 'collar', categories: ['shirts'], price: 300 };
    const d = defaultStylesByPart([neck, sleeve, own]);
    expect(d.get('neckline')).toBe(neck);
    expect(d.get('sleeve')).toBe(sleeve);
    expect(d.get('collar')).toBe(own);
    expect(d.has('top')).toBe(false);
  });

  it('treats the part name loosely and skips styles with none', () => {
    const d = defaultStylesByPart([
      style(' Neckline ', 500),
      style('', 100),
    ] as any);
    expect([...d.keys()]).toEqual(['neckline']);
  });

  it("fills only the parts the customer left empty and keeps their picks", () => {
    const make = (s: any): any => ({ style_id: s._id, filled: true });
    const out = withDefaultStyles([{ style_id: vNeck._id }], styles, make);
    expect(out).toEqual([
      { style_id: vNeck._id },
      { style_id: shortSleeve._id, filled: true },
    ]);
    // Nothing picked: one default per part.
    expect(withDefaultStyles(undefined, styles, make)).toHaveLength(2);
    // An unknown id passes through for the caller to reject.
    const stray = { style_id: id() };
    expect(withDefaultStyles([stray], styles, make)[0]).toBe(stray);
  });

  it('keeps one marked default per part', () => {
    const list = [
      style('collar', 100, { is_default: true }),
      style('collar', 50, { is_default: true }),
      style('skirt', 10, { is_default: true }),
    ];
    keepOneDefaultPerPart(list);
    expect(list.map((s) => s.is_default)).toEqual([true, false, true]);
  });

  it('applies to made-to-order clothing with styles only', () => {
    expect(
      usesDefaultStyles({ kind: 'clothing', clothing: { type: 'customize', styles } }),
    ).toBe(true);
    expect(
      usesDefaultStyles({ kind: 'clothing', clothing: { type: 'non_customize', styles } }),
    ).toBe(false);
    expect(
      usesDefaultStyles({ kind: 'clothing', clothing: { type: 'customize', styles: [] } }),
    ).toBe(false);
  });

  it('prices an outfit bought without opening the customizer at base + defaults', async () => {
    const product: any = {
      _id: id(),
      kind: 'clothing',
      base_price: 20000,
      clothing: { type: 'customize', styles },
    };
    const svc = new PriceCalculationService(
      { findById: async () => product } as any,
      { findById: () => ({ lean: async () => null }) } as any,
    );
    const none = await svc.calculateItemBreakdown({
      product_id: product._id,
      quantity: 1,
      selections: {},
    } as any);
    expect(none.styles_total).toBe(1500);
    expect(none.final).toBe(21500);

    // Swapping to the long sleeve prices the swap, not both sleeves.
    const swapped = await svc.calculateItemBreakdown({
      product_id: product._id,
      quantity: 1,
      selections: {
        style_selection: [{ style_id: longSleeve._id }, { style_id: vNeck._id }],
      },
    } as any);
    expect(swapped.styles_total).toBe(5000);
    expect(swapped.final).toBe(25000);
  });
});
