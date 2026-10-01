import { BadRequestException } from '@nestjs/common';
import { BespokeService } from './bespoke.service';

/**
 * Who may be sent a bespoke quote request.
 *
 * The only check used to be that the business existed, so a shop that sells
 * nothing but belts could be asked to sew a kaftan. A design can only go to a
 * few vendors at once, so each wasted slot costs the customer a real option.
 */
describe('Bespoke vendor eligibility', () => {
  const service: any = Object.create(BespokeService.prototype);
  const assert = (businesses: any[]) =>
    service.assertVendorsAcceptBespoke(businesses);

  it('allows a vendor that takes bespoke work', () => {
    expect(() =>
      assert([{ business_name: 'Kemi Couture', accepts_bespoke: true }]),
    ).not.toThrow();
  });

  it('allows a vendor saved before the field existed', () => {
    // undefined is not "no" — every business was eligible until now, and a
    // falsy test would silently cut off every vendor on the platform.
    expect(() => assert([{ business_name: 'Legacy Tailor' }])).not.toThrow();
  });

  it('rejects a vendor that does not, and names it', () => {
    expect(() =>
      assert([{ business_name: 'Belt Co', accepts_bespoke: false }]),
    ).toThrow(/Belt Co does not take bespoke orders/i);
  });

  it('names every ineligible vendor, not just the first', () => {
    expect(() =>
      assert([
        { business_name: 'Belt Co', accepts_bespoke: false },
        { business_name: 'Kemi Couture', accepts_bespoke: true },
        { business_name: 'Cap World', accepts_bespoke: false },
      ]),
    ).toThrow(/Belt Co, Cap World/);
  });

  it('throws a 400, not a 500', () => {
    expect(() => assert([{ accepts_bespoke: false }])).toThrow(
      BadRequestException,
    );
  });
});
