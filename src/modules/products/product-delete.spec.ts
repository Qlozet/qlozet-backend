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

  it('archives rather than deletes for a vendor', async () => {
    const { service, productModel } = makeService();

    await service.delete(id, userId, UserType.VENDOR);

    expect(productModel.findOneAndDelete).not.toHaveBeenCalled();
    expect(productModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(id) },
      { $set: { status: ProductStatus.ARCHIVED } },
      { new: true },
    );
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
