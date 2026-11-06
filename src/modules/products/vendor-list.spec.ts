import { Types } from 'mongoose';
import { vendorListQuery } from './vendor-list';

describe("a vendor's own products list", () => {
  const vendor = new Types.ObjectId().toHexString();

  it('lists only this store, leaves deleted products out, newest first', () => {
    const { filter, sort } = vendorListQuery({ vendor, kind: 'clothing' });
    expect(filter).toEqual({
      $and: [
        { $or: [{ business: new Types.ObjectId(vendor) }, { business: vendor }] },
        { deleted_at: null },
        { kind: 'clothing' },
      ],
    });
    expect(sort).toEqual({ createdAt: -1 });
  });

  it('searches names and SKUs across every page, treating the text literally', () => {
    const { filter } = vendorListQuery({ vendor, search: '  agbada (blue) ' });
    const search = (filter.$and as any[])[2].$or;
    const rx: RegExp = search[0]['clothing.name'];
    expect(rx.test('Blue AGBADA (blue) set')).toBe(true);
    expect(rx.test('agbada blue')).toBe(false); // brackets are not regex
    expect(search.map((c: any) => Object.keys(c)[0])).toEqual(
      expect.arrayContaining(['fabric.name', 'accessory.name', 'clothing.color_variants.variants.sku']),
    );
  });

  it('sorts by name within the kind, by price, or falls back to newest', () => {
    expect(vendorListQuery({ vendor, kind: 'fabric', sortBy: 'name', order: 'asc' }).sort)
      .toEqual({ 'fabric.name': 1, createdAt: -1 });
    expect(vendorListQuery({ vendor, sortBy: 'price' }).sort).toEqual({ base_price: -1, createdAt: -1 });
    expect(vendorListQuery({ vendor, sortBy: 'stock' }).sort).toEqual({ createdAt: -1 });
  });
});
