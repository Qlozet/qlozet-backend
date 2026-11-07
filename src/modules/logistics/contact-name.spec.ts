import { shipbubbleContactName } from './contact-name';

describe('the contact name sent to Shipbubble', () => {
  it("prefers the owner's full name", () => {
    expect(shipbubbleContactName('Kennedy Ekechukwu', 'BantuBlue')).toBe('Kennedy Ekechukwu');
  });

  it('makes a full name from a store name live Shipbubble refused', () => {
    expect(shipbubbleContactName(undefined, 'BantuBlue')).toBe('Bantu Blue');
    expect(shipbubbleContactName(null, 'Beebo_ng')).toBe('Beebo ng');
    expect(shipbubbleContactName('', 'OMALICHA')).toBe('OMALICHA Store');
    expect(shipbubbleContactName('Ada', 'Afra Threads')).toBe('Afra Threads');
  });

  it('strips numbers and symbols, and never sends an empty name', () => {
    expect(shipbubbleContactName('Tunde  Okafor 2nd')).toBe('Tunde Okafor');
    expect(shipbubbleContactName('123', '!!!')).toBe('Qlozet Vendor');
  });
});
