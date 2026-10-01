import { BadRequestException } from '@nestjs/common';
import { OrderValidationService } from './orders.validation';
import { BusinessStatus } from '../business/schemas/business.schema';

/**
 * Who may be sold on behalf of.
 *
 * Every public catalogue query already hides products from vendors who are not
 * approved — but hiding is not refusing. A product still reaches checkout from
 * a cart saved before the vendor was suspended, a shared link, or a bespoke
 * quote. Until this guard, those orders went through: money taken, and an
 * obligation created with a vendor the platform had never cleared.
 */
describe('Vendor sell gate', () => {
  let stored: any;
  let service: any;

  beforeEach(() => {
    service = Object.create(OrderValidationService.prototype);
    Object.assign(service, {
      businessModel: {
        findById: () => ({
          select: () => ({ lean: async () => stored }),
        }),
      },
    });
  });

  const assert = (business: any) => {
    stored = business;
    return service.assertVendorMaySell('507f1f77bcf86cd799439011');
  };

  it('allows an approved vendor', async () => {
    await expect(
      assert({ business_name: 'Kemi Couture', status: BusinessStatus.APPROVED }),
    ).resolves.toBeUndefined();
  });

  it('allows a verified vendor', async () => {
    await expect(
      assert({ business_name: 'Kemi Couture', status: BusinessStatus.VERIFIED }),
    ).resolves.toBeUndefined();
  });

  it('refuses a vendor still pending verification, by name', async () => {
    await expect(
      assert({ business_name: 'New Store', status: BusinessStatus.PENDING }),
    ).rejects.toThrow(/New Store has not completed verification/i);
  });

  it('refuses a vendor under review', async () => {
    await expect(
      assert({ business_name: 'New Store', status: BusinessStatus.IN_REVIEW }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a rejected vendor', async () => {
    await expect(
      assert({ business_name: 'Bad Store', status: BusinessStatus.REJECTED }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a deactivated vendor even when approved', async () => {
    // Deactivation is the lever support pulls in a hurry; it has to outrank a
    // status that was set weeks ago.
    await expect(
      assert({
        business_name: 'Paused Store',
        status: BusinessStatus.APPROVED,
        is_active: false,
      }),
    ).rejects.toThrow(/not currently trading/i);
  });

  it('refuses an item whose vendor no longer exists', async () => {
    await expect(assert(null)).rejects.toThrow(/no longer exists/i);
  });

  it('tells the customer what to do about it', async () => {
    // The message is the whole interface here: the item is already in their
    // bag, so "cannot be ordered" without "remove it" is a dead end.
    await expect(
      assert({ business_name: 'New Store', status: BusinessStatus.PENDING }),
    ).rejects.toThrow(/Remove it from your bag/i);
  });
});
