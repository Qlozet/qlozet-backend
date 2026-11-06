import { Types } from 'mongoose';

/**
 * The query behind a vendor's own Products tables (GET /products/by-vendor).
 *
 * Search and sort used to arrive and be ignored, so searching only ever
 * filtered the page already on screen. Search matches the product name or
 * a SKU, across every page.
 */

export const VENDOR_LIST_SORTS = ['name', 'price', 'createdAt'] as const;
export type VendorListSort = (typeof VENDOR_LIST_SORTS)[number];

export interface VendorListOptions {
  vendor: string;
  kind?: string;
  search?: string;
  sortBy?: string;
  order?: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function vendorListQuery(opts: VendorListOptions): {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
} {
  const and: Record<string, unknown>[] = [
    // Stored either way (see address-customer-string-type-bug).
    {
      $or: [
        ...(Types.ObjectId.isValid(opts.vendor)
          ? [{ business: new Types.ObjectId(opts.vendor) }]
          : []),
        { business: opts.vendor },
      ],
    },
    // Deleted by the vendor: kept for orders, never listed.
    { deleted_at: null },
  ];
  if (opts.kind) and.push({ kind: opts.kind });

  const term = (opts.search ?? '').trim().slice(0, 100);
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    and.push({
      $or: [
        { 'clothing.name': rx },
        { 'fabric.name': rx },
        { 'accessory.name': rx },
        { 'seo.title': rx },
        // SKUs sit on the variants of each kind.
        { 'clothing.color_variants.variants.sku': rx },
        { 'fabric.variants.sku': rx },
        { 'accessory.variants.sku': rx },
      ],
    });
  }

  const dir: 1 | -1 = opts.order === 'asc' ? 1 : -1;
  const sortBy = (VENDOR_LIST_SORTS as readonly string[]).includes(opts.sortBy ?? '')
    ? (opts.sortBy as VendorListSort)
    : 'createdAt';
  const sort: Record<string, 1 | -1> =
    sortBy === 'name'
      ? { [opts.kind ? `${opts.kind}.name` : 'seo.title']: dir, createdAt: -1 }
      : sortBy === 'price'
        ? { base_price: dir, createdAt: -1 }
        : { createdAt: dir };

  return { filter: { $and: and }, sort };
}
