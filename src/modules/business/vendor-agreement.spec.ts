import {
  SERVICE_AGREEMENT,
  hasAcceptedCurrentAgreement,
} from './service-agreement';
import { VENDOR_AGREEMENTS, getVendorAgreement } from './agreements';

/**
 * The agreement text and its version must stay welded together.
 *
 * A version string is only worth storing if the exact words behind it can
 * still be produced — an acceptance record naming text that has silently
 * changed proves nothing.
 */
describe('Vendor agreement', () => {
  it('publishes the version the code asks vendors to accept', () => {
    // The failure this catches: bumping SERVICE_AGREEMENT.VERSION without
    // adding the file, which would leave every vendor unable to accept.
    expect(getVendorAgreement(SERVICE_AGREEMENT.VERSION)).toBeTruthy();
  });

  it('keeps every past version retrievable', () => {
    for (const version of Object.keys(VENDOR_AGREEMENTS)) {
      expect(getVendorAgreement(version)).toBeTruthy();
    }
  });

  it('returns null for a version that was never published', () => {
    expect(getVendorAgreement('1999-01-01')).toBeNull();
  });

  it('states the terms a vendor is most likely to be surprised by', () => {
    // Not a style check: these are the clauses that cost a vendor money or
    // access, and an agreement that omits them is not describing this
    // platform. If a clause is deliberately dropped, drop it here too.
    const text = getVendorAgreement(SERVICE_AGREEMENT.VERSION) ?? '';
    for (const term of [
      'commission',
      'chargeback',
      'body measurements',
      'Verification is a condition of selling',
      'Money in flight',
      'Nigeria',
    ]) {
      expect(text.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it('only counts the version in force', () => {
    expect(
      hasAcceptedCurrentAgreement({
        service_agreement: { version: SERVICE_AGREEMENT.VERSION },
      }),
    ).toBe(true);
    expect(
      hasAcceptedCurrentAgreement({
        service_agreement: { version: '2026-10-01' },
      }),
    ).toBe(false);
  });
});
