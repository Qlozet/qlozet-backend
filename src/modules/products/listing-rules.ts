import { BadRequestException } from '@nestjs/common';

/**
 * Listing standards, checked when a vendor publishes.
 *
 * These run at publish only. A draft is a workbench and may be in any state;
 * the moment a listing faces customers it has to clear a floor. That split is
 * deliberate - rules that fire while someone is still typing train people to
 * work around them rather than meet them.
 *
 * What is NOT here, because it is enforced earlier and better:
 *  - image resolution, format and size, which assertValidImage applies at
 *    upload with an admin-tunable floor. Catching a blurry photo at upload
 *    beats catching it at publish, when the vendor has moved on.
 *  - duplicate SKUs, which assertSkusAreUnique rejects before any write.
 *  - price above zero, handled in upsert alongside the status resolution.
 *
 * Every violation is collected rather than thrown one at a time. A vendor who
 * fixes a title, resubmits, and is then told about the description learns that
 * publishing is a slot machine; one message listing everything is a to-do list.
 */

/** Longest a title can be before it stops being a title. */
const TITLE_MAX = 120;
const TITLE_MIN = 10;

/** Enough description to answer "what is this", not a token keystroke. */
const DESCRIPTION_MIN = 150;

/** Shoppers judge on the gallery; one photo is a placeholder, not a listing. */
const MIN_IMAGES = 3;

/**
 * Contact details in a listing.
 *
 * Clause 12 of the vendor agreement forbids directing customers off the
 * platform, and a phone number or an Instagram handle in the description is
 * how that actually happens - not by anyone reading the clause and deciding
 * to break it, but because it is the obvious thing to type.
 *
 * Tuned to catch the deliberate cases without tripping on ordinary copy:
 * - Nigerian and international phone numbers, including spaced and dashed
 *   forms, but not a measurement like "32 - 34 inches".
 * - Email addresses.
 * - Social handles and the words people use to ask for contact.
 * Sizing text is full of digits, so the phone pattern demands a plausible
 * run of them rather than any number at all.
 */
const CONTACT_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: 'a phone number',
    // +234..., 0803..., 234 803..., allowing spaces, dashes and brackets.
    pattern: /(?:\+?234|\b0)[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/,
  },
  {
    label: 'an email address',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  },
  {
    label: 'a WhatsApp reference',
    pattern: /\bwhats\s?app\b|\bwa\.me\b/i,
  },
  {
    label: 'a social handle',
    // @name, or "dm us on instagram".
    pattern: /(^|\s)@[A-Za-z0-9._]{3,}|\b(instagram|facebook|telegram|snapchat)\b/i,
  },
  {
    label: 'an invitation to order off the platform',
    pattern: /\b(call|text|dm|chat)\s+(me|us)\b|\border\s+(directly|outside)\b/i,
  },
];

/**
 * The first kind of contact detail found in a piece of text, or null.
 *
 * Exported because the same question gets asked of two different things: the
 * words a vendor types, and the words inside the photos they upload. Someone
 * who cannot put a number in the description will put it in the image, so the
 * two checks have to agree on what counts - one definition, used twice.
 *
 * Returns the first match only. Listing every pattern that fired reads as
 * nagging when the fix is the same either way.
 */
export function findContactDetail(text: string): string | null {
  for (const { label, pattern } of CONTACT_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export interface ListingCandidate {
  title?: string | null;
  description?: string | null;
  images?: unknown[] | null;
  /** Colour/size rows, for the stock check. */
  variants?: { stock?: number | null }[] | null;
}

/** Collect every violation. Empty means the listing may go live. */
export function findListingViolations(listing: ListingCandidate): string[] {
  const problems: string[] = [];

  const title = (listing.title ?? '').trim();
  if (title.length < TITLE_MIN) {
    problems.push(
      `The title is too short — give it at least ${TITLE_MIN} characters so shoppers can tell what it is.`,
    );
  } else if (title.length > TITLE_MAX) {
    problems.push(
      `The title is longer than ${TITLE_MAX} characters. Put the detail in the description.`,
    );
  }

  // Letters only: "2XL KAFTAN" is not shouting, "KAFTAN FOR MEN SALE" is.
  const letters = title.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 10 && letters === letters.toUpperCase()) {
    problems.push('Write the title in normal case rather than all capitals.');
  }

  // eslint-disable-next-line no-misleading-character-class
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(title)) {
    problems.push('Remove emoji from the title.');
  }

  const description = (listing.description ?? '').trim();
  if (description.length < DESCRIPTION_MIN) {
    problems.push(
      `The description needs at least ${DESCRIPTION_MIN} characters — cover the fabric, the fit and the care.`,
    );
  }

  // Checked across both fields: moving a phone number from the description
  // to the title should not get it through.
  const found = findContactDetail(`${title}
${description}`);
  if (found) {
    problems.push(
      `Remove ${found} from the listing. Orders and messages go through Qlozet.`,
    );
  }

  const images = listing.images ?? [];
  if (images.length < MIN_IMAGES) {
    problems.push(
      `Add at least ${MIN_IMAGES} photos — shoppers buy from the gallery.`,
    );
  }

  const variants = listing.variants ?? [];
  if (variants.length > 0 && !variants.some((v) => (v?.stock ?? 0) > 0)) {
    problems.push(
      'Every size is out of stock. Add stock, or save this as a draft.',
    );
  }

  return problems;
}

/**
 * Throw if the listing is not fit to publish.
 *
 * Everything goes into one string rather than a structured field. The global
 * response interceptor rebuilds error bodies and keeps only `message`, and
 * when that message is an array it runs through a factory that returns just
 * the first entry - so a list would quietly lose every problem but one. Each
 * problem is already a sentence, so joining them reads correctly and survives
 * the trip to the vendor intact.
 */
export function assertPublishable(listing: ListingCandidate): void {
  const problems = findListingViolations(listing);
  if (problems.length === 0) return;

  throw new BadRequestException(
    ['This listing is not ready to publish.', ...problems].join(' '),
  );
}
