import { buildDiscountDto, describeDiscount, pickByName, resolveStockTarget, validateListingChange } from './vendor-actions.helpers';

describe('pickByName', () => {
  const items = [{ n: 'Black Kaftan' }, { n: 'Black Kaftan Deluxe' }, { n: 'Agbada' }];
  const nameOf = (i: { n: string }) => i.n;

  it('prefers an exact match even when it is also a prefix of another', () => {
    expect(pickByName(items, 'black kaftan', nameOf)).toEqual({ match: items[0] });
  });
  it('accepts a single partial match, and refuses to guess between several', () => {
    expect(pickByName(items, 'agb', nameOf)).toEqual({ match: items[2] });
    expect(pickByName(items, 'kaftan', nameOf)).toEqual({ ambiguous: ['Black Kaftan', 'Black Kaftan Deluxe'] });
    expect(pickByName(items, 'boubou', nameOf)).toEqual({ none: true });
  });
});

describe('resolveStockTarget', () => {
  const shirt = {
    kind: 'clothing',
    clothing: {
      name: 'Oxford Shirt',
      color_variants: [
        { name: 'White', variants: [{ size: 'M', stock: 4 }, { size: 'L', stock: 0 }] },
        { name: 'Blue', variants: [{ size: 'M', stock: 2 }] },
      ],
    },
  };

  it('resolves colour and size, filling in the only option when there is one', () => {
    expect(resolveStockTarget(shirt, 'white', 'l')).toEqual({ target: { kind: 'clothing', color: 'White', size: 'L', current: 0 } });
    expect(resolveStockTarget(shirt, 'blue')).toEqual({ target: { kind: 'clothing', color: 'Blue', size: 'M', current: 2 } });
  });

  it('asks instead of guessing when colour or size is missing and there are several', () => {
    const noColour = resolveStockTarget(shirt);
    expect('error' in noColour && noColour.error).toContain('2 colours (White, Blue)');
    const noSize = resolveStockTarget(shirt, 'white');
    expect('error' in noSize && noSize.error).toContain('2 sizes (M, L)');
    const wrong = resolveStockTarget(shirt, 'red');
    expect('error' in wrong && wrong.error).toContain('no colour "red"');
  });

  it('treats fabric stock as yards and accessory variants by colour/size', () => {
    expect(resolveStockTarget({ kind: 'fabric', fabric: { name: 'Ankara', yard_length: 30 } })).toEqual({ target: { kind: 'fabric', current: 30 } });
    const bag = { kind: 'accessory', accessory: { name: 'Tote', variants: [{ color: { name: 'Tan' }, size: 'One size', stock: 5 }, { color: { name: 'Black' }, size: 'One size', stock: 1 }] } };
    expect(resolveStockTarget(bag, 'black')).toEqual({ target: { kind: 'accessory', color: 'Black', size: 'One size', current: 1 } });
    const which = resolveStockTarget(bag);
    expect('error' in which && which.error).toContain('2 matching variants');
  });
});

describe('buildDiscountDto', () => {
  it('maps store-wide, kind and product scopes to the types the matcher understands', () => {
    expect(buildDiscountDto({ title: 'Sale', value: 10, value_type: 'percentage', applies_to: 'all' })).toMatchObject({ type: 'store_wide', conditions: [], is_active: true, required_discount: false });
    expect(buildDiscountDto({ title: 'Sale', value: 10, value_type: 'percentage', applies_to: 'fabric' })).toMatchObject({ type: 'category_specific', conditions: [{ field: 'kind', operator: 'is_equal_to', value: 'fabric' }] });
    expect(buildDiscountDto({ title: 'Sale', value: 500, value_type: 'fixed', applies_to: 'products', product_ids: ['a', 'b'] })).toMatchObject({ type: 'fixed', manual_includes: ['a', 'b'], conditions: [] });
  });

  it('a dated discount becomes a flash type, and a dated store-wide one gets a rule every active product passes', () => {
    const end = new Date('2026-12-01');
    const dto = buildDiscountDto({ title: 'Weekend', value: 15, value_type: 'percentage', applies_to: 'all', end_date: end });
    expect(dto.type).toBe('flash_percentage');
    expect(dto.conditions).toEqual([{ field: 'status', operator: 'is_equal_to', value: 'active' }]);
    expect(dto.end_date).toBe(end);
    expect(buildDiscountDto({ title: 'W', value: 1000, value_type: 'fixed', applies_to: 'clothing', start_date: end }).type).toBe('flash_fixed');
  });

  it('describes the discount the way the card and the model should say it', () => {
    expect(describeDiscount({ title: 'S', value: 10, value_type: 'percentage', applies_to: 'all' }, 42)).toBe('10% off everything in the store.');
    expect(describeDiscount({ title: 'S', value: 2000, value_type: 'fixed', applies_to: 'accessory' }, 1)).toBe('₦2,000 off all accessory (1 product).');
  });
});

describe('validateListingChange', () => {
  const product = {
    kind: 'clothing',
    clothing: { name: 'Kaftan', description: 'Old.', taxonomy: { product_type: 'Kaftan', categories: ['Casual'], attributes: [], audience: 'men' } },
  };
  const vocab = { product_types: ['Kaftan', 'Agbada'], categories: ['Casual', 'Occasion', 'Office'], attributes: ['Embroidered', 'Linen'] };
  const longDesc = 'A relaxed linen kaftan with hand embroidery at the neckline, cut for warm evenings and long lunches.';

  it('builds the exact $set paths for the kind and shows before -> after', () => {
    const out = validateListingChange(product, { description: longDesc, audience: 'Unisex', categories: ['occasion', 'Office'], attributes: ['linen'] }, vocab);
    if ('error' in out) throw new Error(out.error);
    expect(out.set).toEqual({
      'clothing.description': `<p>${longDesc}</p>`, // stored as clean HTML
      'clothing.taxonomy.audience': 'unisex',
      'clothing.taxonomy.categories': ['Occasion', 'Office'],
      'clothing.taxonomy.attributes': ['Linen'],
    });
    expect(out.details.find((d) => d.label === 'Audience')?.value).toBe('men → unisex');
    expect(out.details.find((d) => d.label === 'Categories')?.value).toBe('Casual → Occasion, Office');
    expect(out.changed).toEqual(['description', 'audience', 'categories', 'attributes']);
  });

  it('refuses values outside the vocabulary and says what is allowed', () => {
    const out = validateListingChange(product, { categories: ['Wedding'] }, vocab);
    expect('error' in out && out.error).toContain('Not in the allowed categories: Wedding');
    expect('error' in out && out.error).toContain('Casual, Occasion, Office');
    const pt = validateListingChange(product, { product_type: 'Boubou' }, vocab);
    expect('error' in pt && pt.error).toContain('not a product type');
  });

  it('accepts free text where the taxonomy has no vocabulary', () => {
    const out = validateListingChange(product, { categories: ['Anything'] }, { product_types: null, categories: null, attributes: null });
    expect('set' in out && out.set['clothing.taxonomy.categories']).toEqual(['Anything']);
  });

  it('guards the description: length, links, and an empty change', () => {
    expect('error' in validateListingChange(product, { description: 'Too short' }, vocab)).toBe(true);
    expect('error' in validateListingChange(product, { description: `${longDesc} See https://example.com` }, vocab)).toBe(true);
    expect('error' in validateListingChange(product, { audience: 'boys' }, vocab)).toBe(true);
    expect('error' in validateListingChange(product, {}, vocab)).toBe(true);
  });
});
