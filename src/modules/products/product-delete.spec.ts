import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { ProductService } from './products.service';
import { ProductStatus } from './enums/product-status.enum';
import { UserType } from '../ums/schemas/user.schema';

/**
 * Deleting a product from the admin catalogue had never worked, and two
 * separate bugs on the same path each reported the same misleading
 * "Product not found":
 *
 *   1. `UserType.ADMIN` is the string 'platform', but the branch tested for
 *      'admin', so a real admin token matched neither branch.
 *   2. The controller read `req.user.user_type`; the User schema field is
 *      `type`. The only reference to that name in the codebase, so `userType`
 *      arrived undefined whoever was calling.
 *
 * Both are silent failures of the same shape, which is why `delete` now
 * refuses an unrecognised user type out loud.
 */
describe('ProductService.delete — who is allowed, and what it does', () => {
  const id = new Types.ObjectId().toHexString();
  const userId = new Types.ObjectId().toHexString();

  const makeService = (found: unknown = { _id: id }) => {
    const productModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue(found),
      findOneAndDelete: jest.fn().mockResolvedValue(found),
    };
    const service = Object.create(ProductService.prototype) as ProductService;
    (service as any).productModel = productModel;
    return { service, productModel };
  };

  it('hard-deletes for a platform admin', async () => {
    const { service, productModel } = makeService();

    // UserType.ADMIN is 'platform' — the value a real admin token carries.
    await service.delete(id, userId, UserType.ADMIN);

    expect(productModel.findOneAndDelete).toHaveBeenCalledTimes(1);
    expect(productModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still accepts the literal "admin" from any older caller', async () => {
    const { service, productModel } = makeService();
    await service.delete(id, userId, 'admin');
    expect(productModel.findOneAndDelete).toHaveBeenCalledTimes(1);
  });

  it('for a vendor, takes their own product off sale and out of their list', async () => {
    const { service, productModel } = makeService();
    const businessId = new Types.ObjectId().toHexString();

    await service.delete(id, userId, UserType.VENDOR, businessId);

    expect(productModel.findOneAndDelete).not.toHaveBeenCalled();
    const [filter, update] = productModel.findOneAndUpdate.mock.calls[0];
    // Scoped to the vendor's own store; it used to take any product id.
    expect(filter).toEqual({
      _id: new Types.ObjectId(id),
      business: { $in: [new Types.ObjectId(businessId), businessId] },
      deleted_at: null,
    });
    expect(update.$set.status).toBe(ProductStatus.ARCHIVED);
    expect(update.$set.deleted_at).toBeInstanceOf(Date);
  });

  it('refuses a vendor delete with no store on the session', async () => {
    const { service, productModel } = makeService();
    await expect(
      service.delete(id, userId, UserType.VENDOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses an unrecognised user type instead of reporting "not found"', async () => {
    const { service, productModel } = makeService();

    // What the broken controller actually passed.
    await expect(
      service.delete(id, userId, undefined as unknown as string),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(productModel.findOneAndDelete).not.toHaveBeenCalled();
    expect(productModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reports a genuinely missing product as not found', async () => {
    const { service } = makeService(null);
    await expect(
      service.delete(id, userId, UserType.ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
