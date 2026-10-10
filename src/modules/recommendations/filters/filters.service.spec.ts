import { FiltersService } from './filters.service';
import { FilterSpec } from './dto/filter-spec.dto';

/**
 * The hard filters, now that catalog items carry product facts.
 */
describe('FiltersService hard filters', () => {
  const service = new FiltersService();

  const item = (over: any) =>
    ({ itemId: 'x', type: 'garment', name: 'Item', price: 100, tags: [], ...over }) as any;

  const spec = (over: Partial<FilterSpec>): FilterSpec => Object.assign(new FilterSpec(), over);

  it('drops an item whose facts say it is out of stock, keeps unknown stock', () => {
    const items = [
      item({ itemId: 'gone', facts: { in_stock: false, colors: [], sizes: [] } }),
      item({ itemId: 'unknown', facts: { colors: [], sizes: [] } }),
      item({ itemId: 'nofacts' }),
    ];
    const { items: out, metrics } = service.applyHardFilters(items, spec({ inStockOnly: true }));
    expect(out.map((i) => i.itemId)).toEqual(['unknown', 'nofacts']);
    expect(metrics.dropped_stock).toBe(1);
  });

  it('matches audience from facts for every kind, not just garments with fitMeta', () => {
    const items = [
      item({ itemId: 'bag-men', type: 'accessory', facts: { audience: 'men', colors: [], sizes: [] } }),
      item({ itemId: 'bag-women', type: 'accessory', facts: { audience: 'women', colors: [], sizes: [] } }),
      item({ itemId: 'bag-unisex', type: 'accessory', facts: { audience: 'unisex', colors: [], sizes: [] } }),
      item({ itemId: 'legacy', fitMeta: { targetDemographic: 'womens' } }),
    ];
    const { items: out } = service.applyHardFilters(items, spec({ gender: 'female' }));
    expect(out.map((i) => i.itemId)).toEqual(['bag-women', 'bag-unisex', 'legacy']);
  });

  it('filters by colour against the colour variants, or the words the vendor wrote', () => {
    const items = [
      item({ itemId: 'variant', facts: { colors: ['Deep Red', 'Navy'], sizes: [] } }),
      item({ itemId: 'in-name', name: 'Red Ankara Dress', facts: { colors: [], sizes: [] } }),
      item({ itemId: 'in-tags', tags: ['burgundy', 'red'] }),
      item({ itemId: 'blue', facts: { colors: ['Blue'], sizes: [] }, description: 'A calm blue.' }),
    ];
    const { items: out, metrics } = service.applyHardFilters(items, spec({ colors: ['red'] }));
    expect(out.map((i) => i.itemId)).toEqual(['variant', 'in-name', 'in-tags']);
    expect(metrics.dropped_color).toBe(1);
  });

  it('filters by size only when the item lists sizes; unknown sizing is kept', () => {
    const items = [
      item({ itemId: 'has-xl', facts: { colors: [], sizes: ['L', 'XL'] } }),
      item({ itemId: 'no-xl', facts: { colors: [], sizes: ['S', 'M'] } }),
      item({ itemId: 'unsized', facts: { colors: [], sizes: [] } }),
    ];
    const { items: out, metrics } = service.applyHardFilters(items, spec({ size: 'xl' }));
    expect(out.map((i) => i.itemId)).toEqual(['has-xl', 'unsized']);
    expect(metrics.dropped_size).toBe(1);
  });
});
