// Spotting bot sign-ups on the waitlist. One rule, used twice: the join
// endpoints quietly drop a bot (it still sees "you're on the list"), and the
// admin page tags the ones already saved and can delete them. The patterns are
// plain regex sources so Mongo filters by exactly the same rule.

/**
 * A name that is one long run of random letters: no spaces, 10+ letters, 3+
 * capitals after the first letter, and either a lowercase start or two
 * capitals in a row ("WxXpHBUgUJ…", "mClDvJymm…"). "JohnPaulOkafor" is not.
 */
export const BOT_NAME_SOURCE =
  '^(?=[A-Za-z]{10,}$)(?=.(?:[^A-Z]*[A-Z]){3})(?:[a-z]|.*[A-Z]{2})';

/**
 * Four or more dots before the @ ("l.uti.mu.fakec.e0.6@gmail.com"). Gmail
 * ignores dots, so bots use them to sign one inbox up many times.
 */
export const BOT_EMAIL_SOURCE = '^(?:[^@.]*\\.){4}[^@]*@';

const BOT_NAME_RX = new RegExp(BOT_NAME_SOURCE);
const BOT_EMAIL_RX = new RegExp(BOT_EMAIL_SOURCE);

/** Faster than a person can fill the form in. */
export const MIN_FORM_MS = 2000;

export function looksLikeBot(entry: { fullName?: string | null; email?: string | null }): boolean {
  const name = String(entry.fullName ?? '').trim();
  const email = String(entry.email ?? '').trim();
  return BOT_NAME_RX.test(name) || BOT_EMAIL_RX.test(email);
}

export interface JoinSignals {
  fullName?: string;
  email?: string;
  /** Hidden field on the landing form; people never fill it in. */
  website?: string;
  /** Milliseconds between the form showing and being sent. */
  form_ms?: number;
}

/** Why a join attempt is a bot, or null for a person. */
export function botJoinReason(s: JoinSignals): 'honeypot' | 'too_fast' | 'pattern' | null {
  if (String(s.website ?? '').trim()) return 'honeypot';
  const ms = Number(s.form_ms);
  if (s.form_ms != null && Number.isFinite(ms) && ms < MIN_FORM_MS) return 'too_fast';
  if (looksLikeBot(s)) return 'pattern';
  return null;
}

/** The Mongo condition for "likely bot", the same rule as looksLikeBot. */
export const BOT_FILTER = {
  $or: [{ fullName: { $regex: BOT_NAME_SOURCE } }, { email: { $regex: BOT_EMAIL_SOURCE } }],
};
