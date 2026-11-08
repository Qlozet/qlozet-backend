import {
  Candidate,
  LOOK_RULES,
  audienceRegex,
  centroid,
  cosine,
  normalizeGender,
  pickVaried,
  shuffle,
  styleWords,
} from './onboarding-picks';

const look = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  look: { id, kind: 'product', name: id, image: `${id}.jpg`, label: '', vendor: null },
  ...extra,
});

describe('onboarding picks', () => {
  it('matches every spelling of the shopper’s audience plus unisex, never the other one', () => {
    const men = audienceRegex('male');
    ['Men', 'male', "Men's", ' MENS ', 'Unisex', 'all'].forEach((a) => expect(men.test(a)).toBe(true));
    ['Women', 'female', 'ladies', 'menswear?'].forEach((a) => expect(men.test(a)).toBe(false));
    const women = audienceRegex('female');
    expect(women.test('Ladies')).toBe(true);
    expect(women.test('Men')).toBe(false);
  });

  it('reads gender loosely', () => {
    expect(normalizeGender('Men')).toBe('male');
    expect(normalizeGender('female')).toBe('female');
    expect(normalizeGender('unisex')).toBeNull();
  });

  it('caps looks per vendor and per category', () => {
    const items = [
      look('a', { vendorKey: 'v1', categoryKey: 'Agbada' }),
      look('b', { vendorKey: 'V1', categoryKey: 'Kaftan' }),
      look('c', { vendorKey: 'v1', categoryKey: 'Senator' }), // third from v1
      look('d', { vendorKey: 'v2', categoryKey: 'agbada' }),
      look('e', { vendorKey: 'v3', categoryKey: 'Agbada' }),
      look('f', { vendorKey: 'v4', categoryKey: 'Agbada' }), // fourth agbada
    ];
    const ids = pickVaried(items, { ...LOOK_RULES, perVendor: 2, perCategory: 3 }).map((c) => c.look.id);
    expect(ids).toEqual(['a', 'b', 'd', 'e']);
  });

  it('skips near-copies, including of looks already on screen', () => {
    const items = [
      look('a', { vector: [1, 0, 0] }),
      look('b', { vector: [0.999, 0.01, 0] }), // same look as a
      look('c', { vector: [0, 1, 0] }),
      look('d', { vector: [0, 0.01, 0.999] }),
    ];
    expect(pickVaried(items, LOOK_RULES).map((c) => c.look.id)).toEqual(['a', 'c', 'd']);
    const onScreen = [look('x', { vector: [0, 0, 1] })];
    expect(pickVaried(items, LOOK_RULES, onScreen).map((c) => c.look.id)).toEqual(['a', 'c']);
  });

  it('never repeats a look already shown and stops at the limit', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => look(id));
    expect(pickVaried(items, { ...LOOK_RULES, limit: 2 }, [look('a')]).map((c) => c.look.id)).toEqual(['b', 'c']);
  });

  it('cosine and centroid', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine(null, [1])).toBe(0);
    expect(centroid([[1, 0], null, [0, 1]])).toEqual([0.5, 0.5]);
    expect(centroid([])).toBeNull();
  });

  it('shuffles without losing anything', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = shuffle([1, 2, 3, 4, 5], rand);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('turns picks into a short list of style words', () => {
    const words = styleWords(
      [{ categories: ['Agbada', 'Traditional'] }, { productType: 'Kaftan' }, { categories: ['agbada'] }],
      [{ name: 'Senator / Safari', attributes: ['formal', 'modern', 'structured'] }],
    );
    expect(words).toEqual(['senator / safari', 'formal', 'modern', 'agbada', 'traditional', 'kaftan']);
    expect(styleWords([], [{ name: 'x', attributes: Array.from({ length: 2 }, (_, i) => `a${i}`) }], 2)).toHaveLength(2);
  });
});
