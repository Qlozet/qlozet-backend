import {
  DEFAULT_TOKEN_PACKS,
  legacyTokenPrice,
  normalizeTokenPacks,
  publicTokenPacks,
} from './token-packs';

describe('token packs', () => {
  it('every default pack pays for at least three AI designs, and bigger packs give more per naira', () => {
    const packs = publicTokenPacks(undefined, 45);
    expect(packs.map((p) => p.designs)).toEqual([3, 9, 21, 57]);
    const perNaira = packs.map((p) => p.total_tokens / p.price_ngn);
    for (let i = 1; i < perNaira.length; i++) expect(perNaira[i]).toBeGreaterThan(perNaira[i - 1]);
  });

  it('cleans what the admin saved: drops broken rows, unique ids, ordered by price', () => {
    const packs = normalizeTokenPacks([
      { name: 'Big', tokens: 1000, bonus_tokens: 100, price_ngn: 12000, tag: '  Best value ' },
      { name: 'Small', tokens: 100, price_ngn: 1500 },
      { name: 'Small', tokens: 200, price_ngn: 2500, active: false },
      { name: '', tokens: 50, price_ngn: 500 },
      { name: 'Free', tokens: 50, price_ngn: 0 },
    ]);
    expect(packs.map((p) => [p.id, p.price_ngn, p.bonus_tokens, p.tag, p.active])).toEqual([
      ['small', 1500, 0, null, true],
      ['small-2', 2500, 0, null, false],
      ['big', 12000, 100, 'Best value', true],
    ]);
  });

  it('falls back to the defaults when nothing usable is saved', () => {
    expect(normalizeTokenPacks([])).toBe(DEFAULT_TOKEN_PACKS);
    expect(normalizeTokenPacks([{ name: 'x', tokens: 0, price_ngn: 0 }])).toBe(DEFAULT_TOKEN_PACKS);
  });

  it('only shows active packs', () => {
    const shown = publicTokenPacks([
      { name: 'On', tokens: 100, price_ngn: 1500 },
      { name: 'Off', tokens: 500, price_ngn: 5000, active: false },
    ], 45);
    expect(shown.map((p) => p.id)).toEqual(['on']);
  });

  it('an old app buying a bare token count pays the dearest rate, never beating a pack', () => {
    // Starter is ₦2,000 for 150 (₦13.34 a token, the dearest rate).
    expect(legacyTokenPrice(undefined, 15)).toBe(200);
    expect(legacyTokenPrice(undefined, 16)).toBe(214);
    expect(legacyTokenPrice(undefined, 150)).toBe(2000);
  });
});
