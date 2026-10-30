/**
 * When a vendor's earnings become withdrawable: a fixed number of days after
 * the customer pays, whatever happens to the order after that.
 *
 * Paystack (Oct 2026) does not allow holding vendor money until delivery, a
 * return window or a dispute is settled; that is escrow and needs a licence.
 * So nothing here waits on the order. Problems found after payout (returns,
 * dispute refunds, cancellations) are recovered from the vendor's balance,
 * with any shortfall booked as owed and taken from later earnings.
 *
 * The number is published in the Terms of Service and the vendor agreement.
 * Change it only together with those.
 */
export const SETTLEMENT_DAYS = 14;

/** A customer can report a problem up to this many days after delivery. */
export const DISPUTE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The release date for money paid at `paidAt` (default: now). */
export const settlementDate = (paidAt: Date | number = Date.now()): Date =>
  new Date(new Date(paidAt).getTime() + SETTLEMENT_DAYS * DAY_MS);
