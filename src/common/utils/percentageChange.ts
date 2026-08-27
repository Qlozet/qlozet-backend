/**
 * Percentage movement between two periods, for the admin console's stat-card
 * badges.
 *
 * Returns null when the previous period was empty and the current one is not.
 * That case has no meaningful percentage — a first-ever order is not a 100%
 * increase over anything — and the client renders no badge rather than assert
 * a trend. Both periods empty is a genuine "no movement" and returns 0.
 *
 * Rounded to one decimal place.
 *
 * NOTE: this file previously exported a string-returning version that reported
 * "+100%" for the null case. Nothing imported it. The vendor dashboard has its
 * own inline copy with that behaviour (OrderService.getBusinessChart); it is
 * left alone because the vendor app already consumes those strings.
 */
export const percentageChange = (
  current: number,
  previous: number,
): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};
