import { Types } from 'mongoose';
import { DiscoverVendorsService } from './discover-vendors.service';
import { BusinessStatus } from '../business/schemas/business.schema';

/**
 * The storefront's category rows.
 *
 * The home page used to fetch the 50 newest products once and split them four
 * ways, so Accessories, Custom Made, Ready to Wear and Fabric all competed
 * for one budget. A vendor qualified only if one of their products happened
 * to be among those 50 site-wide, and the row's order came from the vendor
 * list — which has no sort, so it was registration date. A whole category
 * could vanish from the page because nobody had uploaded recently.
 *
 * These cover the two things that replaced it: one query per row, and a
 * deliberate order.
 */
describe('Discover vendors by product kind', () => {
  const ACTIVE = new Types.ObjectId();
  const OTHER = new Types.ObjectId();

  let productModel: any;
  let businessModel: any;
  let service: DiscoverVendorsService;
  let grouped: any[];
  let businesses: any[];
  let ratingRows: any[];

  const biz = (over: any = {}) => ({
    _id: new Types.ObjectId(),
    business_name: 'A Shop',
    status: BusinessStatus.APPROVED,
    createdAt: new Date('2024-01-01'),
    ...over,
  });

  const group = (id: any, over: any = {}) => ({
    _id: id,
    products: [{ _id: new Types.ObjectId(), kind: 'accessory' }],
    product_count: 5,
    last_listed_at: new Date(),
    ...over,
  });

  beforeEach(() => {
    businesses = [biz({ _id: ACTIVE, business_name: 'Active' })];
    grouped = [group(ACTIVE)];
    ratingRows = [];

    productModel = {
      // First call groups the catalogue; the second rolls up ratings.
      aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
        const isRatings = JSON.stringify(pipeline).includes('$unwind');
        return Promise.resolve(isRatings ? ratingRows : grouped);
      }),
    };
    businessModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(businesses) }),
      }),
    };

    service = new DiscoverVendorsService(productModel, businessModel);
  });

  const run = (over: any = {}) =>
    service.vendorsForKind({ kind: 'accessory', ...over });

  const names = async (over: any = {}) => {
    const { data } = await run(over);
    return data.vendors.map((v: any) => v.business_name);
  };

  const matchStage = () => productModel.aggregate.mock.calls[0][0][0].$match;

  describe('one query per row', () => {
    it('filters by kind, so rows cannot starve each other', async () => {
      // The whole point: Fabric no longer disappears because clothing was
      // uploaded more recently.
      await run({ kind: 'fabric' });
      expect(matchStage().kind).toBe('fabric');
    });

    it('separates Custom Made from Ready to Wear', async () => {
      await run({ kind: 'clothing', clothingType: 'customize' });
      expect(matchStage()['clothing.type']).toBe('customize');

      productModel.aggregate.mockClear();
      await run({ kind: 'clothing', clothingType: 'non_customize' });
      expect(matchStage()['clothing.type']).toBe('non_customize');
    });

    it('shows only active, unrejected products', async () => {
      await run();
      const m = matchStage();
      expect(m.status).toBe('active');
      expect(m['moderation.status']).toEqual({ $ne: 'rejected' });
    });

    it('matches audience both ways, and keeps untagged products', async () => {
      await run({ audience: 'men' });
      const or = matchStage().$or;
      expect(or[0]['accessory.taxonomy.audience'].$in).toEqual(
        expect.arrayContaining(['men', 'unisex', 'male']),
      );
      // An untagged product should not vanish just because nobody filled in
      // the taxonomy.
      expect(or[1]['accessory.taxonomy.audience']).toEqual({ $exists: false });
    });

    it('takes only a few products per vendor', async () => {
      await run({ perVendor: 3 });
      const project = productModel.aggregate.mock.calls[0][0].find(
        (st: any) => st.$project,
      );
      expect(project.$project.products.$slice[1]).toBe(3);
    });
  });

  describe('who is eligible', () => {
    it('drops a vendor the platform does not list', async () => {
      // A product can be active while its shop is pending or rejected.
      grouped = [group(ACTIVE), group(OTHER)];
      businesses = [biz({ _id: ACTIVE, business_name: 'Active' })];
      expect(await names()).toEqual(['Active']);
    });

    it('asks for approved or verified only', async () => {
      await run();
      const [filter] = businessModel.find.mock.calls[0];
      expect(filter.status).toEqual({
        $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED],
      });
    });

    it('returns nothing rather than failing on an empty category', async () => {
      grouped = [];
      const { data } = await run();
      expect(data.vendors).toEqual([]);
      expect(data.total).toBe(0);
      // No point asking for businesses when no product matched.
      expect(businessModel.find).not.toHaveBeenCalled();
    });
  });

  describe('the order', () => {
    it('is not registration date', async () => {
      // The old behaviour: whoever registered first sat at the front of every
      // row, permanently.
      const old = biz({ business_name: 'Oldest', createdAt: new Date('2020-01-01') });
      const newer = biz({ business_name: 'Newer', status: BusinessStatus.VERIFIED });
      businesses = [old, newer];
      grouped = [group(old._id), group(newer._id)];

      expect((await names())[0]).toBe('Newer');
    });

    it('favours a verified shop over an otherwise equal one', async () => {
      const a = biz({ business_name: 'Approved' });
      const v = biz({ business_name: 'Verified', status: BusinessStatus.VERIFIED });
      businesses = [a, v];
      grouped = [group(a._id), group(v._id)];

      expect((await names())[0]).toBe('Verified');
    });

    it('favours a shop that has listed recently', async () => {
      const stale = biz({ business_name: 'Stale' });
      const fresh = biz({ business_name: 'Fresh' });
      businesses = [stale, fresh];
      grouped = [
        group(stale._id, { last_listed_at: new Date('2023-01-01') }),
        group(fresh._id, { last_listed_at: new Date() }),
      ];

      expect((await names())[0]).toBe('Fresh');
    });

    it('decays recency rather than cutting it off', async () => {
      // Someone who listed 50 days ago should rank just below someone at 40
      // days, not drop out — a cliff makes the row lurch week to week.
      const a = biz({ business_name: 'Day40' });
      const b = biz({ business_name: 'Day50' });
      businesses = [a, b];
      const day = 86_400_000;
      grouped = [
        group(b._id, { last_listed_at: new Date(Date.now() - 50 * day) }),
        group(a._id, { last_listed_at: new Date(Date.now() - 40 * day) }),
      ];

      expect(await names()).toEqual(['Day40', 'Day50']);
    });

    it('saturates catalogue size so the biggest shop cannot own every row', async () => {
      const huge = biz({ business_name: 'Huge' });
      const rated = biz({ business_name: 'Rated' });
      businesses = [huge, rated];
      grouped = [
        group(huge._id, { product_count: 5000 }),
        group(rated._id, { product_count: 4 }),
      ];
      ratingRows = [{ _id: rated._id, average: 4.9, count: 30 }];

      expect((await names())[0]).toBe('Rated');
    });

    it('ignores a rating too thin to mean anything', async () => {
      const one = biz({ business_name: 'OneReview' });
      const none = biz({ business_name: 'NoReviews' });
      businesses = [one, none];
      grouped = [group(one._id), group(none._id)];
      ratingRows = [{ _id: one._id, average: 5, count: 1 }];

      const { data } = await run();
      const row = data.vendors.find((v: any) => v.business_name === 'OneReview');
      // Reported for display, but not scored.
      expect(row.total_ratings).toBe(1);
      expect(row.average_rating).toBe(5);
    });

    it('still ranks when the rating roll-up fails', async () => {
      productModel.aggregate.mockImplementation((pipeline: any[]) =>
        JSON.stringify(pipeline).includes('$unwind')
          ? Promise.reject(new Error('mongo down'))
          : Promise.resolve(grouped),
      );
      await expect(names()).resolves.toEqual(['Active']);
    });
  });

  describe('room for new shops', () => {
    it('promotes a newcomer into the visible row', async () => {
      // Without it the row is a closed loop: never shown, so never rated, so
      // never shown.
      const established = Array.from({ length: 8 }, (_, i) =>
        biz({ business_name: `Established ${i}`, status: BusinessStatus.VERIFIED }),
      );
      const newcomer = biz({ business_name: 'Brand New', createdAt: new Date() });
      businesses = [...established, newcomer];
      grouped = businesses.map((b) => group(b._id, { product_count: 50 }));

      const order = await names({ limit: 8 });
      expect(order).toHaveLength(8);
      expect(order).toContain('Brand New');
    });

    it('does not promote a recent joiner who is already well rated', async () => {
      const newcomer = biz({ business_name: 'Rated Newcomer', createdAt: new Date() });
      businesses = [newcomer];
      grouped = [group(newcomer._id)];
      ratingRows = [{ _id: newcomer._id, average: 4.9, count: 20 }];

      const { data } = await run();
      // It earns its place on the rating; no slot needs spending on it.
      expect(data.vendors[0].business_name).toBe('Rated Newcomer');
    });
  });

  describe('what a row carries', () => {
    it('includes the rating, the verified flag and sample products', async () => {
      ratingRows = [{ _id: ACTIVE, average: 4.6, count: 11 }];
      businesses = [biz({ _id: ACTIVE, business_name: 'Active', status: BusinessStatus.VERIFIED })];

      const { data } = await run();
      const row = data.vendors[0];
      expect(row.average_rating).toBe(4.6);
      expect(row.total_ratings).toBe(11);
      expect(row.verified).toBe(true);
      expect(row.product_count).toBe(5);
      expect(row.products).toHaveLength(1);
    });

    it('reports the full count so the row can offer a "see all"', async () => {
      const a = biz({ business_name: 'A' });
      const b = biz({ business_name: 'B' });
      businesses = [a, b];
      grouped = [group(a._id), group(b._id)];

      const { data } = await run({ limit: 1 });
      expect(data.vendors).toHaveLength(1);
      expect(data.total).toBe(2);
    });

    it('clamps absurd limits', async () => {
      await run({ limit: 9999, perVendor: 9999 });
      const project = productModel.aggregate.mock.calls[0][0].find(
        (st: any) => st.$project,
      );
      expect(project.$project.products.$slice[1]).toBeLessThanOrEqual(10);
    });
  });
});
