import { isOnSale } from './on-sale';

describe('isOnSale', () => {
  it('is on sale with a discounted price below base', () => {
    expect(isOnSale({ base_price: 20000, discounted_price: 15000 })).toBe(true);
  });

  it('is not on sale without a discounted price', () => {
    expect(isOnSale({ base_price: 20000 })).toBe(false);
    expect(isOnSale({ base_price: 20000, discounted_price: 0 })).toBe(false);
  });

  it('is not on sale when the "sale" price is not lower', () => {
    expect(isOnSale({ base_price: 20000, discounted_price: 20000 })).toBe(false);
    expect(isOnSale({ base_price: 20000, discounted_price: 25000 })).toBe(false);
  });

  it('handles a missing product', () => {
    expect(isOnSale(null)).toBe(false);
    expect(isOnSale(undefined)).toBe(false);
  });
});
