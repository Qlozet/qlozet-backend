/**
 * The vendor service agreement a business must accept before being reviewed.
 *
 * The version is the whole point. An agreement nobody can date is worth little
 * if it is ever disputed, so the acceptance record stores which text was
 * accepted, when, by whom and from where — and a new version re-prompts rather
 * than silently applying to people who never saw it.
 *
 * Bump `VERSION` whenever the terms change in substance. Fixing a typo is not
 * a substantive change; altering commission, payout timing, liability or
 * termination is.
 */
export const SERVICE_AGREEMENT = {
  /** ISO date of the text currently in force. Must exist in ./agreements. */
  VERSION: '2026-10-02',
} as const;

/**
 * The text is served from this API, not linked to a marketing page.
 *
 * An earlier draft of this file argued the opposite - keep the text outside
 * the codebase so it can be changed without a deploy. That was wrong. If the
 * words live on a page someone can edit and the version lives in code, the
 * two drift: an acceptance record saying "2026-10-02" then refers to text
 * that has silently changed, which destroys the only thing the record is for.
 *
 * Versions are immutable files under ./agreements. Changing the terms is a
 * commit someone reviews, with a diff and a history - which, for a contract,
 * is the right amount of friction.
 */

/** Whether this business has accepted the version currently in force. */
export const hasAcceptedCurrentAgreement = (business: {
  service_agreement?: { version?: string } | null;
}): boolean => business?.service_agreement?.version === SERVICE_AGREEMENT.VERSION;
