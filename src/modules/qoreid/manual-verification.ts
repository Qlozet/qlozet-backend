/**
 * Manual vendor verification: the stop-gap while QoreID is not available.
 *
 * The admin setting `vendor_verification_mode` picks the route:
 *  - 'qoreid' (default): the vendor runs the hosted QoreID checks, then
 *    submits, then an admin decides.
 *  - 'manual': the vendor accepts the agreement, gives their CAC number and
 *    links a payout account (its name is confirmed by the bank through
 *    Paystack), then submits. The Qlozet team checks the CAC register, the
 *    payout name and calls the owner, ticks each on the review screen, and
 *    approves. The approval is recorded as manual.
 *
 * When the setting goes back to 'qoreid', every manually approved vendor is
 * given a deadline (`manual_verification_grace_days`, default 30) to finish
 * the QoreID checks. They keep selling meanwhile; passing the checks clears
 * the deadline. A vendor still unfinished at the deadline is paused (listings
 * hidden, no new orders) until they finish and an admin approves them.
 *
 * Pure rules here; the controllers, admin decision and the daily check use
 * them so they cannot disagree.
 */

export type VerificationMode = 'qoreid' | 'manual';
export type VerificationMethod = 'qoreid' | 'manual';

export const DEFAULT_GRACE_DAYS = 30;

export const MANUAL_CHECKS = ['cac_register', 'payout_name', 'owner_call'] as const;
export type ManualCheck = (typeof MANUAL_CHECKS)[number];

export const MANUAL_CHECK_LABELS: Record<ManualCheck, string> = {
  cac_register: 'Found the CAC number on the public CAC register, under this business name',
  payout_name: 'The payout account name matches the business or its owner',
  owner_call: 'Spoke to the owner on a call and confirmed who they are',
};

export function verificationMode(settings: { vendor_verification_mode?: string | null } | null | undefined): VerificationMode {
  return settings?.vendor_verification_mode === 'manual' ? 'manual' : 'qoreid';
}

export function graceDays(settings: { manual_verification_grace_days?: number | null } | null | undefined): number {
  const n = Number(settings?.manual_verification_grace_days);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : DEFAULT_GRACE_DAYS;
}

/** Checks the reviewer has not ticked yet. Approving needs none left. */
export function missingManualChecks(
  checks: Partial<Record<string, unknown>> | null | undefined,
): ManualCheck[] {
  return MANUAL_CHECKS.filter((c) => checks?.[c] !== true);
}

export function fullCheckDueAt(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/** CAC numbers look like RC123456, BN1234567 or IT12345 (letters optional). */
export function cleanRcNumber(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^(RC|BN|IT|LP|LLP)?\d{4,9}$/.test(v) ? v : null;
}

/**
 * Why a vendor cannot submit for manual review, or null when they can.
 * Every reason names what to do next, because the vendor sees it.
 */
export function manualSubmitProblem(
  b: {
    verification_state?: string | null;
    payout_account_number?: string | null;
    payout_account_name?: string | null;
  },
  ctx: { mode: VerificationMode; agreementAccepted: boolean; rcNumber: string | null },
): string | null {
  if (ctx.mode !== 'manual') {
    return 'Verification runs through our identity checks now. Open Verification to start them.';
  }
  const state = b.verification_state ?? 'not_started';
  if (state === 'awaiting_review') return 'Your business is already under review.';
  if (state === 'approved') return 'Your business is already approved.';
  if (state === 'rejected') return 'This business was rejected. Contact support to reopen it.';
  if (!ctx.agreementAccepted) return 'Accept the vendor agreement before submitting.';
  if (!ctx.rcNumber) return 'Enter your CAC registration number, such as RC1234567 or BN1234567.';
  if (!b.payout_account_number || !b.payout_account_name) {
    return 'Link your payout account under Settings → Payout first. We check its name with your bank.';
  }
  return null;
}

/** A manually approved vendor whose time to finish the full checks is up. */
export function pastFullCheckDeadline(
  b: { verification_method?: string | null; verification_state?: string | null; full_verification_due_at?: Date | string | null },
  now: Date,
): boolean {
  if (b.verification_method !== 'manual' || b.verification_state !== 'approved') return false;
  if (!b.full_verification_due_at) return false;
  return new Date(b.full_verification_due_at).getTime() <= now.getTime();
}

export const DEADLINE_PASSED_MESSAGE =
  'Your time to finish verification has passed, so your products are hidden for now. ' +
  'Finish the identity checks on the Verification page and we will review your store again.';
