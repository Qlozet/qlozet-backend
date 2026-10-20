/**
 * Whether a measurement set has enough in it for a tailor to cut from.
 *
 * A custom or bespoke order freezes one of the customer's saved sets onto the
 * order, and the tailor sews from that snapshot. An order placed with no set,
 * or an empty one, reached the tailor with a blank sheet. Every way of adding
 * measurements (photo scan, height-and-weight estimate, manual entry) fills
 * all the core body points, so three positive values is a floor that only a
 * missing or empty set fails.
 */
export const MIN_MEASUREMENT_VALUES = 3;

export const NO_MEASUREMENTS_MESSAGE =
  'Add your measurements before ordering a piece made to fit you. Go to Profile, then My Measurement.';

export function hasUsableMeasurements(
  measurements: Record<string, unknown> | null | undefined,
): boolean {
  if (!measurements || typeof measurements !== 'object') return false;
  let count = 0;
  for (const value of Object.values(measurements)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) count += 1;
    if (count >= MIN_MEASUREMENT_VALUES) return true;
  }
  return false;
}
