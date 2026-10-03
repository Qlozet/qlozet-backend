import { VENDOR_AGREEMENT_2026_10_02 } from './vendor-agreement-2026-10-02';

/**
 * Every version of the vendor agreement that has ever been in force.
 *
 * Nothing is ever removed or edited in place. A vendor's acceptance record
 * stores a version string, and that record is worth something only if the
 * exact words behind it can still be produced — editing a published version
 * would silently rewrite what people agreed to.
 *
 * To change the terms: add a new file, add it here, and point
 * SERVICE_AGREEMENT.VERSION at it. Every vendor is then asked to accept the
 * new version before they can submit or keep selling.
 */
export const VENDOR_AGREEMENTS: Record<string, string> = {
  '2026-10-02': VENDOR_AGREEMENT_2026_10_02,
};

export const getVendorAgreement = (version: string): string | null =>
  VENDOR_AGREEMENTS[version] ?? null;
