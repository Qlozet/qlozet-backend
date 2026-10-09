import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SuggestedVendorsService } from './suggested-vendors.service';

/**
 * Which tailors to offer for a design.
 *
 * The Choose Tailors modal used to show the vendor list in no order at all —
 * getPublicVendors has no sort, so Mongo's natural order put the earliest
 * registered tailors first and they collected the work. That was demand
 * allocation nobody decided, so these tests are about the ordering being
 * deliberate and explainable rather than merely different.
 */
describe('Suggested vendors for a bespoke design', () => {
  const FABRIC_OWNER = new Types.ObjectId();
  const AGBADA_MAKER = new Types.ObjectId();
  const GENERALIST = new Types.ObjectId();
  const FABRIC_OWNER_FABRIC = new Types.ObjectId();

  let designModel: any;
  let businessModel: any;
  let productModel: any;
  let service: SuggestedVendorsService;
  let businesses: any[];
  let ratingRows: any[];
  let design: any;

  const biz = (over: any = {}) => ({
    _id: new Types.ObjectId(),
    business_name: 'A Tailor',
    business_category: 'tailoring',
    accepts_bespoke: true,
    success_rate: 0,
    total_items_sold: 0,
    // Old enough not to count as new unless a test says otherwise.
    createdAt: new Date('2024-01-01'),
    ...over,
  });

  beforeEach(() => {
    design = {
      _id: new Types.ObjectId(),
      category: 'Agbada',
      gender: 'men',
      fabric: { business: FABRIC_OWNER },
    };

    businesses = [
      biz({ _id: GENERALIST, business_name: 'Generalist', business_category: 'tailoring' }),
      biz({ _id: AGBADA_MAKER, business_name: 'Agbada Maker', business_category: 'Agbada specialists' }),
      biz({ _id: FABRIC_OWNER, business_name: 'Fabric House', business_category: 'fabrics' }),
    ];

    ratingRows = [];

    designModel = {
      findById: () => ({
        select: () => ({ populate: () => ({ lean: () => Promise.resolve(design) }) }),
      }),
    };
    businessModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(businesses) }),
      }),
    };
    productModel = {
      aggregate: jest.fn().mockImplementation(() => Promise.resolve(ratingRows)),
    };

    service = new SuggestedVendorsService(designModel, businessModel, productModel);
  });

  const names = async (limit = 8) => {
    const { data } = await service.forDesign(String(design._id), limit);
    return data.vendors.map((v) => v.business_name);
  };

  const reasonsFor = async (name: string) => {
    const { data } = await service.forDesign(String(design._id));
    return (
      data.vendors
        .find((v) => v.business_name === name)
        ?.reasons.map((r) => r.code) ?? []
    );
  };

  it('puts the fabric supplier first', async () => {
    // The only signal here that changes what the customer pays: everyone else
    // has the cross-vendor fabric surcharge added at acceptance.
    expect((await names())[0]).toBe('Fabric House');
    expect(await reasonsFor('Fabric House')).toContain('fabric_owner');
  });

  it('puts a category match above a generalist', async () => {
    const order = await names();
    expect(order.indexOf('Agbada Maker')).toBeLessThan(
      order.indexOf('Generalist'),
    );
    expect(await reasonsFor('Agbada Maker')).toContain('category_match');
  });

  it('ranks on category and rating when the design has no fabric', async () => {
    design.fabric = null;
    const order = await names();
    expect(order[0]).toBe('Agbada Maker');
    expect(await reasonsFor('Fabric House')).not.toContain('fabric_owner');
  });

  it('says what it ordered by', async () => {
    const withFabric = await service.forDesign(String(design._id));
    expect(withFabric.data.ranked_by).toContain('fabric');

    design.fabric = null;
    const without = await service.forDesign(String(design._id));
    expect(without.data.ranked_by).not.toContain('fabric');
  });

  describe('ratings', () => {
    it('ignores a rating too thin to mean anything', async () => {
      // One five-star review is not a track record, and letting it outrank a
      // tailor with fifty reviews would make the list worse than random.
      ratingRows = [{ _id: GENERALIST, average: 5, count: 1 }];
      expect(await reasonsFor('Generalist')).not.toContain('well_rated');
    });

    it('counts a rating with enough reviews behind it', async () => {
      ratingRows = [{ _id: GENERALIST, average: 4.8, count: 12 }];
      expect(await reasonsFor('Generalist')).toContain('well_rated');
    });

    it('reports the average and count on the row', async () => {
      ratingRows = [{ _id: GENERALIST, average: 4.84, count: 12 }];
      const { data } = await service.forDesign(String(design._id));
      const row = data.vendors.find((v) => v._id === String(GENERALIST));
      expect(row?.average_rating).toBe(4.8);
      expect(row?.total_ratings).toBe(12);
    });

    it('still ranks when the rating roll-up fails', async () => {
      // A ranking without ratings is still a ranking; losing the list
      // entirely would be worse.
      productModel.aggregate.mockRejectedValue(new Error('mongo down'));
      await expect(names()).resolves.toHaveLength(3);
    });
  });

  describe('reliability and experience', () => {
    it('reads success_rate as a percentage or a fraction', async () => {
      businesses = [
        biz({ business_name: 'Percent', success_rate: 95 }),
        biz({ business_name: 'Fraction', success_rate: 0.95 }),
      ];
      design.fabric = null;
      expect(await reasonsFor('Percent')).toContain('reliable');
      expect(await reasonsFor('Fraction')).toContain('reliable');
    });

    it('saturates experience so the biggest shop cannot win forever', async () => {
      businesses = [
        biz({ business_name: 'Huge', total_items_sold: 5000 }),
        biz({
          business_name: 'Specialist',
          business_category: 'Agbada',
          total_items_sold: 15,
        }),
      ];
      design.fabric = null;
      const order = await names();
      // A category match is worth more than sheer volume — otherwise the
      // ranking just restates who is already biggest.
      expect(order[0]).toBe('Specialist');
    });
  });

  describe('making room for new tailors', () => {
    it('promotes a newcomer into the visible list', async () => {
      // Without this the ranking is a closed loop: no ratings means never
      // suggested, which means never rated.
      businesses = [
        ...Array.from({ length: 8 }, (_, i) =>
          biz({
            business_name: `Established ${i}`,
            total_items_sold: 100,
            success_rate: 0.95,
          }),
        ),
        biz({ business_name: 'Brand New', createdAt: new Date() }),
      ];
      design.fabric = null;

      const order = await names(8);
      expect(order).toHaveLength(8);
      expect(order).toContain('Brand New');
    });

    it('labels a promoted newcomer so the order is explainable', async () => {
      businesses = [
        ...Array.from({ length: 8 }, (_, i) =>
          biz({ business_name: `Established ${i}`, total_items_sold: 100 }),
        ),
        biz({ business_name: 'Brand New', createdAt: new Date() }),
      ];
      design.fabric = null;
      expect(await reasonsFor('Brand New')).toContain('new_here');
    });

    it('does not treat a well-reviewed recent joiner as needing help', async () => {
      ratingRows = [{ _id: GENERALIST, average: 4.9, count: 20 }];
      businesses = [biz({ _id: GENERALIST, business_name: 'Generalist', createdAt: new Date() })];
      design.fabric = null;
      expect(await reasonsFor('Generalist')).not.toContain('new_here');
    });
  });

  describe('the candidate pool', () => {
    it('only considers tailors who take bespoke work', async () => {
      await service.forDesign(String(design._id));
      const [filter] = businessModel.find.mock.calls[0];
      // Offering one who does not sew spends a slot on someone who will never
      // answer, and request-quotes rejects it anyway.
      expect(filter).toEqual({ accepts_bespoke: { $ne: false } });
    });

    it('reports the full count so the client can offer "see all"', async () => {
      const { data } = await service.forDesign(String(design._id), 2);
      expect(data.vendors).toHaveLength(2);
      expect(data.total).toBe(3);
    });

    it('copes with no tailors at all', async () => {
      businesses = [];
      const { data } = await service.forDesign(String(design._id));
      expect(data.vendors).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('404s on a design that does not exist', async () => {
      designModel.findById = () => ({
        select: () => ({ populate: () => ({ lean: () => Promise.resolve(null) }) }),
      });
      await expect(
        service.forDesign(String(design._id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('for a design that has not been saved yet', () => {
    // The usual case: the studio saves a design when quotes are requested,
    // not before, so a first request has no id to rank against.
    beforeEach(() => {
      productModel.findById = jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve({ business: FABRIC_OWNER }) }),
      });
    });

    it('ranks from a category and a fabric id', async () => {
      const { data } = await service.forCriteria({
        category: 'Agbada',
        fabricId: String(FABRIC_OWNER_FABRIC),
      });
      expect(data.vendors[0].business_name).toBe('Fabric House');
      expect(data.ranked_by).toContain('fabric');
    });

    it('ranks on category alone with no fabric', async () => {
      const { data } = await service.forCriteria({ category: 'Agbada' });
      expect(data.vendors[0].business_name).toBe('Agbada Maker');
      expect(data.ranked_by).not.toContain('fabric');
    });

    it('ignores a fabric slot holding a style id rather than a product', async () => {
      // The studio's fabric slot can hold a style-library id, which owns
      // nothing — looking it up as a product would be a wasted query at best.
      const { data } = await service.forCriteria({
        category: 'Agbada',
        fabricId: 'neckline-round',
      });
      expect(productModel.findById).not.toHaveBeenCalled();
      expect(data.ranked_by).not.toContain('fabric');
    });

    it('still ranks with no criteria at all', async () => {
      const { data } = await service.forCriteria({});
      expect(data.vendors).toHaveLength(3);
    });
  });

  it('never ranks on is_featured', async () => {
    // It exists on the business record. If it fed this list, "Recommended"
    // would quietly mean "promoted", which is what makes a ranking
    // untrustworthy.
    businesses = [
      biz({ business_name: 'Promoted', is_featured: true }),
      biz({ business_name: 'Specialist', business_category: 'Agbada' }),
    ];
    design.fabric = null;
    expect((await names())[0]).toBe('Specialist');
  });
});
