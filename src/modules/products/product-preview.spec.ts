import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PREVIEW_TTL_MS,
  signProductPreview,
  verifyProductPreview,
} from './product-preview';
import { ProductService } from './products.service';
import { setListingReviewMode } from './customer-visibility';

const SECRET = 'test-secret';

describe('product preview tokens', () => {
  const id = new Types.ObjectId().toString();
  const now = 1_700_000_000_000;

  it('accepts a fresh token for the same product', () => {
    const { token, expires_at } = signProductPreview(SECRET, id, now);
    expect(expires_at.getTime()).toBe(now + PREVIEW_TTL_MS);
    expect(verifyProductPreview(SECRET, id, token, now + 1000)).toBe(true);
  });

  it('refuses an expired token', () => {
    const { token } = signProductPreview(SECRET, id, now);
    expect(verifyProductPreview(SECRET, id, token, now + PREVIEW_TTL_MS)).toBe(
      false,
    );
  });

  it('refuses a token for another product, secret, or a changed expiry', () => {
    const { token } = signProductPreview(SECRET, id, now);
    const other = new Types.ObjectId().toString();
    expect(verifyProductPreview(SECRET, other, token, now)).toBe(false);
    expect(verifyProductPreview('other-secret', id, token, now)).toBe(false);
    const [, sig] = token.split('.');
    const stretched = `${now + 10 * PREVIEW_TTL_MS}.${sig}`;
    expect(verifyProductPreview(SECRET, id, stretched, now)).toBe(false);
  });

  it('refuses junk and an empty secret', () => {
    for (const junk of [undefined, '', 'abc', '.x', '12.', 'x.y'])
      expect(verifyProductPreview(SECRET, id, junk, now)).toBe(false);
    const { token } = signProductPreview(SECRET, id, now);
    expect(verifyProductPreview('', id, token, now)).toBe(false);
  });
});

describe('ProductService preview', () => {
  const productId = new Types.ObjectId();
  const businessId = new Types.ObjectId();
  let product: any;
  let business: any;
  let service: ProductService;
  const oldSecret = process.env.JWT_SECRET;

  const chain = (value: () => any) => ({
    select: () => chain(value),
    populate: () => chain(value),
    lean: () => chain(value),
    exec: async () => value(),
    catch: () => Promise.resolve(value()),
    then: (res: any, rej: any) => Promise.resolve(value()).then(res, rej),
  });

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    setListingReviewMode('review_first');
    product = {
      _id: productId,
      business: businessId,
      status: 'draft',
      moderation: { status: 'pending' },
      variants: [],
    };
    business = { _id: businessId, status: 'approved', is_active: true };
    const productModel = { findById: () => chain(() => product) };
    const businessModel = { findById: () => chain(() => business) };
    const settingsModel = { findOne: () => chain(() => null) };
    const ctorArgs: any[] = new Array(14).fill({});
    ctorArgs[0] = productModel;
    ctorArgs[6] = settingsModel;
    ctorArgs[7] = businessModel;
    service = new (ProductService as any)(...ctorArgs);
  });

  afterAll(() => {
    process.env.JWT_SECRET = oldSecret;
  });

  it('hides a draft from the shop without a token', async () => {
    await expect(
      service.findByIdWithAvailability(String(productId)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives the owning store a link that opens the draft, marked not live', async () => {
    const link = await service.createPreviewLink(
      String(productId),
      String(businessId),
    );
    expect(link.live).toBe(false);
    expect(link.reason).toBe('not_active');
    const seen = await service.findByIdWithAvailability(
      String(productId),
      link.token,
    );
    expect(seen.preview).toEqual({ live: false, reason: 'not_active' });
    expect(String(seen._id)).toBe(String(productId));
  });

  it('says why an active listing is not live yet', async () => {
    product.status = 'active';
    const inReview = await service.createPreviewLink(
      String(productId),
      String(businessId),
    );
    expect(inReview.reason).toBe('in_review');

    product.moderation = { status: 'approved' };
    business.status = 'pending';
    const store = await service.createPreviewLink(
      String(productId),
      String(businessId),
    );
    expect(store.reason).toBe('store_not_approved');

    business.status = 'approved';
    const live = await service.createPreviewLink(
      String(productId),
      String(businessId),
    );
    expect(live).toMatchObject({ live: true, reason: null });
  });

  it("refuses another store's listing and a deleted one", async () => {
    await expect(
      service.createPreviewLink(
        String(productId),
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    product.deleted_at = new Date();
    await expect(
      service.createPreviewLink(String(productId), String(businessId)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ignores a bad token and applies the normal rule', async () => {
    await expect(
      service.findByIdWithAvailability(String(productId), '123.nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
