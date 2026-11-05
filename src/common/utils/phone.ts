import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * One spelling per number: "+234 (0)803-123 4567" and "+2348031234567" are
 * the same phone, and the duplicate checks compare strings. Valid numbers
 * become E.164; anything else is returned trimmed for @IsPhoneNumber to
 * refuse with its message.
 */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (!v) return v;
  const parsed = parsePhoneNumberFromString(v);
  return parsed?.isValid() ? parsed.number : v;
}

/**
 * For class-transformer: `@Transform(phoneTransform)`. A blank field counts
 * as not given (forms send "" for an empty optional phone).
 */
export const phoneTransform = ({ value }: { value: unknown }) =>
  typeof value === 'string' && !value.trim()
    ? undefined
    : normalizePhone(value);

/** The validation message for a bad number, in words a person can act on. */
export const PHONE_MESSAGE =
  'Enter a valid phone number with its country code, like +234 803 123 4567.';
