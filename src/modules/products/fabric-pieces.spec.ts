import {
  normaliseFabricPieces,
  piecesOnly,
  resolveFabricPurchase,
  roundToSellable,
  sellsPieces,
} from './fabric-pieces';

const ankara = (over: Record<string, unknown> = {}) => ({
  name: 'Ankara',
  sold_by: 'piece',
  piece_yards: 6,
  piece_price: 24_000,
  price_per_yard: 4_000,
  min_cut: 6,
  yard_length: 30,
  ...over,
});

describe('fabric sold by the piece', () => {
  it('prices whole pieces and stores them as piece length × pieces', () => {
    expect(resolveFabricPurchase(ankara(), { pieces: 2 })).toEqual({
      yardage: 6,
      quantity: 2,
      pieces: 2,
      totalYards: 12,
      cost: 48_000,
    });
  });

  it('refuses part pieces, too many pieces, and loose yards on a piece-only fabric', () => {
    expect(() => resolveFabricPurchase(ankara(), { pieces: 1.5 })).toThrow(/whole number/);
    expect(() => resolveFabricPurchase(ankara(), { pieces: 6 })).toThrow(/Only 5 pieces/);
    expect(() => resolveFabricPurchase(ankara(), { yardage: 4 })).toThrow(/sold by the 6-yard piece/);
  });

  it('a "both" fabric sells loose yards per yard and pieces at the piece price', () => {
    const f = ankara({ sold_by: 'both', price_per_yard: 4_500 });
    expect(resolveFabricPurchase(f, { yardage: 3 }).cost).toBe(13_500);
    expect(resolveFabricPurchase(f, { pieces: 1 }).cost).toBe(24_000);
    expect(piecesOnly(f)).toBe(false);
    expect(sellsPieces(f)).toBe(true);
  });

  it('a yard fabric refuses pieces', () => {
    expect(() =>
      resolveFabricPurchase(ankara({ sold_by: 'yard' }), { pieces: 1 }),
    ).toThrow(/not sold by the piece/);
  });

  it('a garment needing 4 yards of a piece-only fabric buys one whole piece', () => {
    expect(roundToSellable(ankara(), 4)).toEqual({ yards: 6, pieces: 1, cost: 24_000 });
    expect(roundToSellable(ankara(), 6)).toEqual({ yards: 6, pieces: 1, cost: 24_000 });
    expect(roundToSellable(ankara(), 7)).toEqual({ yards: 12, pieces: 2, cost: 48_000 });
    // Sold by the yard: unchanged.
    expect(roundToSellable(ankara({ sold_by: 'yard' }), 4)).toEqual({ yards: 4, pieces: null, cost: 16_000 });
  });

  it('saving a piece-only fabric derives its per-yard price and minimum cut', () => {
    const f: any = { sold_by: 'piece', piece_yards: 6, piece_price: 25_000, price_per_yard: 0, min_cut: 1 };
    expect(normaliseFabricPieces(f)).toBe(25_000);
    expect(f.price_per_yard).toBe(4_166.67);
    expect(f.min_cut).toBe(6);
  });

  it('saving needs the piece length and price when selling by the piece', () => {
    expect(() => normaliseFabricPieces({ sold_by: 'both', piece_price: 1 })).toThrow(/yards are in one piece/);
    expect(() => normaliseFabricPieces({ sold_by: 'piece', piece_yards: 6 })).toThrow(/price of one piece/);
    const yardOnly: any = { price_per_yard: 3_000 };
    expect(normaliseFabricPieces(yardOnly)).toBeNull();
    expect(yardOnly.sold_by).toBe('yard');
  });
});
