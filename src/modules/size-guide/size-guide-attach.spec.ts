import { Types } from 'mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SizeGuideService } from './size-guide.service';
import { listingMeetsCondition } from '../../common/utils/conditionUtils';

/**
 * A size guide a vendor picks on a listing must stay there, rules must reach
 * new and edited listings, and a guide switched off must stop showing.
 */
describe('size guide attachment', () => {
  const biz = new Types.ObjectId();
  const productId = new Types.ObjectId();

  const kaftan = {
    _id: productId,
    business: biz,
    kind: 'clothing',
    clothing: { taxonomy: { product_type: 'Kaftan', categories: ['Traditional', 'Agbada'] } },
  };

  describe('rule matching', () => {
    it('matches a list field with "is equal to", ignoring case', () => {
      expect(listingMeetsCondition(kaftan, 'clothing.taxonomy.categories', 'is_equal_to', 'agbada')).toBe(true);
    });
    it('reads "is not equal to" on a list as "none of them"', () => {
      expect(listingMeetsCondition(kaftan, 'clothing.taxonomy.categories', 'not_equal_to', 'Agbada')).toBe(false);
      expect(listingMeetsCondition(kaftan, 'clothing.taxonomy.categories', 'not_equal_to', 'Ankara')).toBe(true);
    });
    it('compares numbers as numbers', () => {
      expect(listingMeetsCondition({ base_price: 25000 }, 'base_price', 'greater_than', '9000')).toBe(true);
    });
  });

  const guideDoc = (over: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    business: biz,
    is_active: true,
    condition_match: 'all',
    conditions: [{ field: 'clothing.taxonomy.product_type', operator: 'is_equal_to', value: 'kaftan' }],
    manual_includes: [] as Types.ObjectId[],
    manual_excludes: [] as Types.ObjectId[],
    ...over,
  });

  const build = (guides: any[]) => {
    const productUpdates: any[] = [];
    const guideUpdates: any[] = [];
    const sizeGuideModel: any = {
      find: jest.fn(() => ({ sort: () => ({ exec: async () => guides }) })),
      findOne: jest.fn((q: any) => ({
        select: () => ({ lean: () => ({ exec: async () => guides.find((g) => String(g._id) === String(q._id) && g.is_active !== false) ?? null }) }),
        lean: async () => guides.find((g) => String(g._id) === String(q._id)) ?? null,
      })),
      updateMany: jest.fn(async (q: any, u: any) => guideUpdates.push(['many', q, u])),
      updateOne: jest.fn(async (q: any, u: any) => guideUpdates.push(['one', q, u])),
    };
    const productModel: any = {
      updateOne: jest.fn(async (q: any, u: any) => productUpdates.push(u)),
      findById: () => ({ select: () => ({ lean: async () => ({ size_guide: kaftan._id && null }) }) }),
    };
    const service = new SizeGuideService(sizeGuideModel, productModel, {} as any);
    return { service, productUpdates, guideUpdates };
  };

  it('attaches a guide to a listing saved after the guide (the event carries the product itself)', async () => {
    const g = guideDoc();
    const { service, productUpdates } = build([g]);
    await service.handleProductUpserted({ ...kaftan, size_guide: null });
    expect(productUpdates).toEqual([{ $set: { size_guide: g._id } }]);
  });

  it('prefers the guide that names the listing by hand over a rule match', async () => {
    const ruled = guideDoc();
    const picked = guideDoc({ conditions: [], manual_includes: [productId] });
    const { service, productUpdates } = build([ruled, picked]);
    await service.handleProductUpserted({ ...kaftan, size_guide: null });
    expect(productUpdates).toEqual([{ $set: { size_guide: picked._id } }]);
  });

  it('pins a guide picked on the listing so no rule moves it', async () => {
    const chosen = new Types.ObjectId();
    const { service, guideUpdates, productUpdates } = build([]);
    await service.handleProductUpserted({ ...kaftan, size_guide: chosen }, { size_guide_chosen: true });
    expect(productUpdates).toEqual([]);
    const includeOnChosen = guideUpdates.find(
      ([kind, q, u]) => kind === 'one' && String(q._id) === String(chosen) && u.$addToSet?.manual_includes,
    );
    expect(includeOnChosen).toBeTruthy();
    const excludeElsewhere = guideUpdates.find(
      ([kind, q, u]) => kind === 'many' && q._id?.$ne && u.$addToSet?.manual_excludes,
    );
    expect(excludeElsewhere).toBeTruthy();
  });

  it('keeps "No size guide" chosen on the listing out of every guide', async () => {
    const { service, guideUpdates } = build([]);
    await service.handleProductUpserted({ ...kaftan, size_guide: null }, { size_guide_chosen: true });
    expect(
      guideUpdates.some(([kind, q, u]) => kind === 'many' && !q._id && u.$addToSet?.manual_excludes),
    ).toBe(true);
  });

  it('hides a switched-off guide from shoppers', async () => {
    const off = guideDoc({ is_active: false });
    const { service } = build([off]);
    (service as any).productModel.findById = () => ({
      select: () => ({ lean: async () => ({ size_guide: off._id }) }),
    });
    await expect(service.getGuideForProduct(String(productId))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a size range that runs backwards', async () => {
    const { service } = build([]);
    await expect(
      service.create(
        {
          title: 'Kaftans',
          unit: 'cm',
          body_parts: ['chest'],
          sizes: [{ label: 'M', measurements: [{ body_part: 'chest', min: 101, max: 96 }] }],
        } as any,
        String(biz),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
