import { normalizeAudience, productFacts } from './product-facts';

describe('productFacts', () => {
  it('normalises every spelling of an audience, and leaves nonsense undefined', () => {
    expect(normalizeAudience('Male')).toBe('men');
    expect(normalizeAudience("women's")).toBe('women');
    expect(normalizeAudience('Unisex')).toBe('unisex');
    expect(normalizeAudience('kids')).toBeUndefined();
    expect(normalizeAudience(undefined)).toBeUndefined();
  });

  it('reads a ready-to-wear garment: colours, sizes that are in stock, audience', () => {
    const facts = productFacts({
      kind: 'clothing',
      base_price: 60000,
      discounted_price: 45000,
      average_rating: 4.63,
      total_ratings: 12,
      clothing: {
        type: 'non_customize',
        taxonomy: { audience: 'female' },
        turnaround_days: 0,
        color_variants: [
          { name: 'Red', variants: [{ size: 'M', stock: 2 }, { size: 'L', stock: 0 }] },
          { name: 'Navy', variants: [{ size: 'L', stock: 1 }, { size: 'XL', stock: 0 }] },
          { name: 'red', variants: [] },
        ],
      },
    });

    expect(facts.audience).toBe('women');
    expect(facts.colors).toEqual(['Red', 'Navy']);
    expect(facts.sizes).toEqual(['M', 'L']);
    expect(facts.in_stock).toBe(true);
    expect(facts.made_to_order).toBe(false);
    expect(facts.discounted_price).toBe(45000);
    expect(facts.rating).toBe(4.6);
    expect(facts.rating_count).toBe(12);
  });

  it('a garment whose tracked stock is all gone is out of stock; untracked stock is unknown', () => {
    const gone = productFacts({
      kind: 'clothing',
      clothing: { type: 'non_customize', color_variants: [{ name: 'Black', variants: [{ size: 'S', stock: 0 }] }] },
    });
    expect(gone.in_stock).toBe(false);
    expect(gone.sizes).toEqual([]);

    const unknown = productFacts({
      kind: 'clothing',
      clothing: { type: 'non_customize', color_variants: [{ name: 'Black', variants: [{ size: 'S' }, { size: 'M' }] }] },
    });
    expect(unknown.in_stock).toBeUndefined();
    expect(unknown.sizes).toEqual(['S', 'M']);
  });

  it('a made-to-order garment is always available in every listed size, with its turnaround', () => {
    const facts = productFacts({
      kind: 'clothing',
      clothing: {
        type: 'customize',
        turnaround_days: 10,
        color_variants: [{ name: 'Gold', variants: [{ size: 'M', stock: 0 }, { size: 'XXL', stock: 0 }] }],
      },
    });
    expect(facts.made_to_order).toBe(true);
    expect(facts.turnaround_days).toBe(10);
    expect(facts.in_stock).toBe(true);
    expect(facts.sizes).toEqual(['M', 'XXL']);
  });

  it('reads a fabric: material, pattern, per-yard price, colours', () => {
    const facts = productFacts({
      kind: 'fabric',
      base_price: 3500,
      fabric: {
        taxonomy: { audience: 'unisex' },
        material: 'Ankara cotton',
        pattern: 'Geometric',
        price_per_yard: 3500,
        colors: [{ name: 'Teal' }, { name: 'Orange' }],
      },
    });
    expect(facts.audience).toBe('unisex');
    expect(facts.material).toBe('Ankara cotton');
    expect(facts.pattern).toBe('Geometric');
    expect(facts.price_per_yard).toBe(3500);
    expect(facts.colors).toEqual(['Teal', 'Orange']);
    expect(facts.in_stock).toBeUndefined();
  });

  it('reads an accessory, and respects its in_stock switch over variant counts', () => {
    const facts = productFacts({
      kind: 'accessory',
      accessory: {
        taxonomy: { audience: 'men' },
        in_stock: false,
        variants: [{ color: { name: 'Tan' }, size: 'One size', stock: 5 }],
      },
    });
    expect(facts.audience).toBe('men');
    expect(facts.colors).toEqual(['Tan']);
    expect(facts.sizes).toEqual(['One size']);
    expect(facts.in_stock).toBe(false);
  });

  it('ignores a discount that is not actually lower, and ratings with no reviews', () => {
    const facts = productFacts({ kind: 'clothing', base_price: 100, discounted_price: 100, average_rating: 5, total_ratings: 0, clothing: {} });
    expect(facts.discounted_price).toBeUndefined();
    expect(facts.rating).toBeUndefined();
  });
});
