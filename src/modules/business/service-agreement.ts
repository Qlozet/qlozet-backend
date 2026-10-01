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
  /** ISO date of the text currently in force. */
  VERSION: '2026-10-01',

  /**
   * Where the full text lives. Kept out of this constant on purpose: the
   * agreement is a legal document that the people who write it must be able to
   * change without a deploy, and embedding it here invites it drifting from
   * whatever the website actually shows.
   */
  URL: '/legal/vendor-agreement',
} as const;

/** Whether this business has accepted the version currently in force. */
export const hasAcceptedCurrentAgreement = (business: {
  service_agreement?: { version?: string } | null;
}): boolean => business?.service_agreement?.version === SERVICE_AGREEMENT.VERSION;
