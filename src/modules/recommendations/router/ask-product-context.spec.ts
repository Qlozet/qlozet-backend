import { buildProductContext, describeProduct, factsLine } from './ask-product-context';

/**
 * What the stylist reads about each product. It used to get a name, a price
 * and the vendor's ObjectId; now it gets the facts a shopper asks about.
 */
describe('ask product context', () => {
  it('names the vendor, the audience, the cut, colours, sizes in stock and the rating', () => {
    const line = factsLine({
      name: 'Agbada',
      price: 60000,
      vendor: "Kemi's Atelier",
      kind: 'clothing',
      facts: {
        audience: 'men',
        made_to_order: false,
        colors: ['Navy', 'Gold'],
        sizes: ['M', 'L'],
        in_stock: true,
        discounted_price: 45000,
        rating: 4.6,
        rating_count: 12,
      },
    });
    expect(line).toBe(
      "₦45,000 (was ₦60,000) · by Kemi's Atelier · men's · ready to wear · colours: Navy, Gold · sizes in stock: M, L · rated 4.6/5 by 12",
    );
  });

  it('says made to order with its turnaround, and lists all sizes without claiming stock', () => {
    const line = factsLine({
      name: 'Kaftan', price: 30000, kind: 'clothing',
      facts: { made_to_order: true, turnaround_days: 10, colors: [], sizes: ['S', 'M', 'L'] },
    });
    expect(line).toContain('made to order, about 10 days');
    expect(line).toContain('sizes: S, M, L');
    expect(line).not.toContain('in stock');
  });

  it('prices fabric per yard and shows material and pattern', () => {
    const line = factsLine({
      name: 'Ankara', price: 3500, kind: 'fabric',
      facts: { colors: ['Teal'], sizes: [], material: 'Cotton', pattern: 'Geometric', price_per_yard: 3500 },
    });
    expect(line.startsWith('₦3,500 per yard')).toBe(true);
    expect(line).toContain('material: Cotton · pattern: Geometric');
  });

  it('flags an out-of-stock item instead of listing sizes', () => {
    const line = factsLine({ name: 'Tote', price: 12000, kind: 'accessory', facts: { colors: [], sizes: ['One size'], in_stock: false } });
    expect(line).toContain('currently out of stock');
    expect(line).not.toContain('One size');
  });

  it('keeps the description capped and the tags trimmed, and numbers the list', () => {
    const long = 'x'.repeat(300);
    const text = describeProduct(2, { name: 'Dress', price: 1, description: long, tags: Array.from({ length: 12 }, (_, i) => `t${i}`) });
    expect(text.startsWith('3. "Dress"')).toBe(true);
    expect(text).toContain('x'.repeat(220) + '…');
    expect(text).toContain('Tags: t0, t1, t2, t3, t4, t5, t6, t7');
    expect(text).not.toContain('t8');
  });

  it('says so when nothing matched', () => {
    expect(buildProductContext([])).toBe('No products matched the query.');
  });
});
