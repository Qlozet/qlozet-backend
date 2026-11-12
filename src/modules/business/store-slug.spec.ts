import { ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessService } from './business.service';
import { BusinessSchema, BusinessStatus } from './schemas/business.schema';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import {
  PREVIOUS_SLUGS_KEPT,
  ensureStoreSlug,
  slugFromName,
  slugProblem,
} from './store-slug';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Store addresses: shop.qlozet.app/s/<slug> instead of /vendor/<id>.
 * Made from the name at sign-up, changeable in settings, old ones keep
 * redirecting and can't be taken by another store.
 */
describe('Store addresses - rules', () => {
  it('makes a readable address from a store name', () => {
    expect(slugFromName('Adaeze Couture')).toBe('adaeze-couture');
    expect(slugFromName('  Kemi & Co.  ')).toBe('kemi-and-co');
    expect(slugFromName("Ada's Atelier")).toBe('adas-atelier');
    expect(slugFromName('Café Ọ̀ṣun Styles')).toBe('cafe-osun-styles');
  });

  it('always gives something usable, even for odd names', () => {
    for (const name of ['', '!!!', 'AB', undefined, 'Qlozet', 'Admin', 'x'.repeat(90)]) {
      expect(slugProblem(slugFromName(name))).toBeNull();
    }
  });

  it('cuts a long name at a word boundary', () => {
    const slug = slugFromName('The Very Long Named Fashion House Of Lagos Island Couture');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toBe('the-very-long-named-fashion-house-of');
  });

  it('refuses bad formats, ids and reserved names with a reason', () => {
    expect(slugProblem('ab')).toMatch(/at least/);
    expect(slugProblem('Has Space')).toMatch(/lowercase/);
    expect(slugProblem('-lead')).toMatch(/hyphen/);
    expect(slugProblem('double--dash')).toMatch(/hyphen/);
    expect(slugProblem('6ac674e81bd4c45a2c67e5bb')).toMatch(/word/);
    expect(slugProblem('admin')).toMatch(/reserved/);
    expect(slugProblem('qlozet-official-store')).toMatch(/reserved/);
    expect(slugProblem('adaeze-couture')).toBeNull();
  });
});

describe('Store addresses - stored', () => {
  const mongo = new MemoryMongo();
  let businessModel: any;
  let service: any;

  const store = (name: string, extra: Record<string, unknown> = {}) =>
    businessModel.create({
      business_name: name,
      status: BusinessStatus.APPROVED,
      ...extra,
    });

  beforeAll(async () => {
    await mongo.start();
    businessModel = mongo.model('Business', BusinessSchema);
    await businessModel.init(); // build the unique index before the races
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await businessModel.deleteMany({});
    service = Object.create(BusinessService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      businessModel,
      getCapacity: async () => ({ at_capacity: false }),
    });
  });

  it('gives the first store the plain address and the next one -2', async () => {
    const a = await store('Ada Couture');
    const b = await store('Ada Couture');
    expect(await ensureStoreSlug(businessModel.collection, a)).toBe('ada-couture');
    expect(await ensureStoreSlug(businessModel.collection, b)).toBe('ada-couture-2');
    // Already has one: kept.
    const again = await businessModel.findById(a._id).lean();
    expect(await ensureStoreSlug(businessModel.collection, again)).toBe('ada-couture');
  });

  it('two sign-ups with the same name at once still end up different', async () => {
    const stores = await Promise.all([1, 2, 3, 4].map(() => store('Twin Tailors')));
    const slugs = await Promise.all(
      stores.map((s) => ensureStoreSlug(businessModel.collection, s)),
    );
    expect(new Set(slugs).size).toBe(4);
  });

  it('many stores without an address do not clash on the unique index', async () => {
    // A null default would make the second one fail with E11000.
    await store('One');
    await expect(store('Two')).resolves.toBeTruthy();
  });

  it('changing the address keeps the old one redirecting', async () => {
    const a = await store('Kemi Styles', { slug: 'kemi-styles' });
    const res = await service.updateStoreSlug(String(a._id), '  Kemi-Lagos ');
    expect(res).toEqual({ slug: 'kemi-lagos', previous_slugs: ['kemi-styles'] });

    const byOld = await service.getPublicProfile('kemi-styles');
    expect(String(byOld._id)).toBe(String(a._id));
    expect(byOld.slug).toBe('kemi-lagos'); // the shop moves the browser here

    const byNew = await service.getPublicProfile('kemi-lagos');
    expect(String(byNew._id)).toBe(String(a._id));
    const byId = await service.getPublicProfile(String(a._id));
    expect(byId.slug).toBe('kemi-lagos');
  });

  it("another store can't take a current or kept address", async () => {
    const a = await store('Kemi Styles', { slug: 'kemi-styles' });
    const b = await store('Other');
    await service.updateStoreSlug(String(a._id), 'kemi-lagos');

    await expect(service.updateStoreSlug(String(b._id), 'kemi-lagos')).rejects.toMatchObject({ status: 409 });
    await expect(service.updateStoreSlug(String(b._id), 'kemi-styles')).rejects.toMatchObject({ status: 409 });

    const check = await service.checkStoreSlug(String(b._id), 'kemi-styles');
    expect(check.available).toBe(false);
    expect(check.suggestion).toBe('kemi-styles-2');
  });

  it('a store can go back to its own old address', async () => {
    const a = await store('Kemi Styles', { slug: 'kemi-styles' });
    await service.updateStoreSlug(String(a._id), 'kemi-lagos');
    expect((await service.checkStoreSlug(String(a._id), 'kemi-styles')).available).toBe(true);
    const res = await service.updateStoreSlug(String(a._id), 'kemi-styles');
    expect(res).toEqual({ slug: 'kemi-styles', previous_slugs: ['kemi-lagos'] });
  });

  it(`keeps at most ${PREVIOUS_SLUGS_KEPT} old addresses, freeing the oldest`, async () => {
    const a = await store('Hopper', { slug: 'hop-0' });
    for (let i = 1; i <= PREVIOUS_SLUGS_KEPT + 1; i++) {
      await service.updateStoreSlug(String(a._id), `hop-${i}`);
    }
    const doc = await businessModel.findById(a._id).lean();
    expect(doc.previous_slugs).toHaveLength(PREVIOUS_SLUGS_KEPT);
    expect(doc.previous_slugs).not.toContain('hop-0');
    const b = await store('Other');
    expect((await service.checkStoreSlug(String(b._id), 'hop-0')).available).toBe(true);
  });

  it('refuses a bad address with the reason', async () => {
    const a = await store('Kemi Styles');
    await expect(service.updateStoreSlug(String(a._id), 'admin')).rejects.toMatchObject({ status: 400 });
    const check = await service.checkStoreSlug(String(a._id), 'a b');
    expect(check).toMatchObject({ available: false });
    expect(check.reason).toMatch(/lowercase/);
  });

  it("a store that isn't approved has no public page by address either", async () => {
    await store('Pending Place', { slug: 'pending-place', status: BusinessStatus.PENDING });
    await expect(service.getPublicProfile('pending-place')).rejects.toMatchObject({ status: 404 });
    await expect(service.getPublicProfile('no-such-store')).rejects.toMatchObject({ status: 404 });
    await expect(service.getPublicProfile(String(new Types.ObjectId()))).rejects.toMatchObject({ status: 404 });
  });

  it('Settings gives an old store an address on first look', async () => {
    const a = await store('Old Timer');
    expect(await service.getStoreAddress(String(a._id))).toEqual({
      slug: 'old-timer',
      previous_slugs: [],
    });
  });
});

describe('PATCH /business/profile', () => {
  // The service $sets the body as is. Before the whitelist a store owner could
  // send status: 'verified' and approve their own store.
  it('drops fields that are not profile fields', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const cleaned = await pipe.transform(
      {
        business_name: 'Kemi Styles',
        theme_color: '#8D7F72',
        social_links: { instagram: '@kemi', evil: 'x' },
        status: 'verified',
        slug: 'admin',
        previous_slugs: ['x'],
        earnings: 10_000,
      },
      { type: 'body', metatype: UpdateBusinessProfileDto },
    );
    expect(Object.keys(cleaned).sort()).toEqual(['business_name', 'social_links', 'theme_color']);
    expect(cleaned.social_links).toEqual({ instagram: 'kemi' });
  });
});
