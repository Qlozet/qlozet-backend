import { fitsMeItems, FitMatch } from './fits-me';

const none = { itemIds: new Set<string>(), vendorIds: new Set<string>() };
const fit = (id: string, score: number, size = 'M', business = 'b1'): FitMatch => ({
  product: { _id: id, business: { _id: business } },
  bestSize: size,
  fitScore: score,
});

describe('fitsMeItems', () => {
  it('puts the best fit first and keeps catalogue order on ties', () => {
    const out = fitsMeItems([fit('a', 0.7), fit('b', 1), fit('c', 0.7)], none, 10);
    expect(out.map((i) => i.itemId)).toEqual(['b', 'a', 'c']);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('says the size it fits in', () => {
    const [item] = fitsMeItems([fit('a', 1, 'L')], none, 10);
    expect(item.explanations).toEqual(['Fits you in size L']);
    expect(item.fit).toEqual({ bestSize: 'L', fitScore: 1 });
    expect(item.reasonCodes).toEqual(['fits_measurements']);
  });

  it('falls back to a general reason without a size', () => {
    const [item] = fitsMeItems([fit('a', 1, 'Unknown')], none, 10);
    expect(item.explanations).toEqual(['Fits your measurements']);
  });

  it('drops dismissed items and hidden stores', () => {
    const out = fitsMeItems(
      [fit('a', 1), fit('b', 1, 'M', 'hidden'), fit('c', 1)],
      { itemIds: new Set(['a']), vendorIds: new Set(['hidden']) },
      10,
    );
    expect(out.map((i) => i.itemId)).toEqual(['c']);
  });

  it('keeps one entry per product and respects the limit', () => {
    const out = fitsMeItems([fit('a', 1), fit('a', 0.8), fit('b', 0.9), fit('c', 0.7)], none, 2);
    expect(out.map((i) => i.itemId)).toEqual(['a', 'b']);
  });
});
