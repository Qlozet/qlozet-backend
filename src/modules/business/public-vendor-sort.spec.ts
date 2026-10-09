import { BusinessService, type PublicVendorSort } from './business.service';

/**
 * The order of the public vendor list.
 *
 * It had no sort at all, which was two faults at once. The visible one: Mongo's
 * natural order put the earliest-registered vendors first, so they led every
 * vendor list in the shop permanently. The quieter one: an unsorted find()
 * with skip/limit has no defined order between calls, so paging could show one
 * vendor twice and never show another.
 *
 * Reaching the sort table through the prototype rather than standing up the
 * service: the table IS the decision, and the service pulls in a dozen models
 * to instantiate.
 */
describe('Public vendor list ordering', () => {
  const SORTS = (BusinessService as unknown as {
    PUBLIC_VENDOR_SORTS: Record<PublicVendorSort, Record<string, 1 | -1>>;
  }).PUBLIC_VENDOR_SORTS;

  const keys = Object.keys(SORTS) as PublicVendorSort[];

  it('offers the three orderings the storefront needs', () => {
    expect(keys.sort()).toEqual(['active', 'name', 'newest']);
  });

  it('ends every ordering with _id, so paging is stable', () => {
    // Without a unique final key, two vendors that tie on everything else can
    // swap between page 1 and page 2 — which shows one twice and hides the
    // other. This is the part that was actually broken, not just unordered.
    for (const key of keys) {
      const fields = Object.keys(SORTS[key]);
      expect(fields[fields.length - 1]).toBe('_id');
    }
  });

  it('leads the default on sales, not on is_featured', () => {
    // The featured flag exists on the business record. Putting it first would
    // make the default order quietly editorial; if featured placement is ever
    // wanted it belongs on the card where a customer can see it.
    const fields = Object.keys(SORTS.active);
    expect(fields[0]).toBe('total_items_sold');
    for (const key of keys) {
      expect(Object.keys(SORTS[key])).not.toContain('is_featured');
    }
  });

  it('breaks ties on recency before falling back to the id', () => {
    expect(Object.keys(SORTS.active)).toEqual([
      'total_items_sold',
      'createdAt',
      '_id',
    ]);
  });

  it('orders newest by creation, descending', () => {
    expect(SORTS.newest.createdAt).toBe(-1);
  });

  it('orders by name ascending, which is the only one that should', () => {
    expect(SORTS.name.business_name).toBe(1);
    expect(SORTS.active.total_items_sold).toBe(-1);
    expect(SORTS.newest.createdAt).toBe(-1);
  });

  it('never sorts a field it does not also select', () => {
    // A sort on an unprojected field still works in Mongo, but it means the
    // client cannot see why the order is what it is — and the website
    // omission below is a reminder that the projection is curated.
    const projected = new Set([
      'business_name',
      'total_items_sold',
      'createdAt',
      '_id',
      'success_rate',
      'is_featured',
      'year_founded',
    ]);
    for (const key of keys) {
      for (const field of Object.keys(SORTS[key])) {
        expect(projected.has(field)).toBe(true);
      }
    }
  });
});
