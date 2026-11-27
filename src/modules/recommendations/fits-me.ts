/**
 * "Fits your measurements": the products whose size guide fits the
 * shopper's active measurements (SizeGuideService.findProductsThatFit),
 * minus what they dismissed, best fit first.
 */

export interface FitMatch {
  product: { _id: unknown; business?: unknown };
  bestSize: string;
  fitScore: number;
}

export interface FitsMeItem {
  itemId: string;
  position: number;
  fit: { bestSize: string; fitScore: number };
  reasonCodes: string[];
  explanations: string[];
}

function businessId(business: unknown): string {
  if (!business) return '';
  if (typeof business === 'object' && business !== null && '_id' in business) {
    return String((business as { _id: unknown })._id);
  }
  return String(business);
}

/**
 * Feed items from fit matches: drops "Not interested" items and hidden
 * stores, keeps one entry per product, orders by fit score (stable, so the
 * catalogue order breaks ties), and says why ("Fits you in size M").
 */
export function fitsMeItems(
  fits: FitMatch[],
  exclusions: { itemIds: Set<string>; vendorIds: Set<string> },
  limit: number,
): FitsMeItem[] {
  const seen = new Set<string>();
  const kept = fits.filter((f) => {
    const id = String(f.product._id);
    if (seen.has(id)) return false;
    seen.add(id);
    if (exclusions.itemIds.has(id)) return false;
    const vendor = businessId(f.product.business);
    return !(vendor && exclusions.vendorIds.has(vendor));
  });
  const ordered = kept
    .map((f, i) => ({ f, i }))
    .sort((a, b) => b.f.fitScore - a.f.fitScore || a.i - b.i)
    .map(({ f }) => f);
  return ordered.slice(0, Math.max(0, limit)).map((f, position) => ({
    itemId: String(f.product._id),
    position,
    fit: { bestSize: f.bestSize, fitScore: f.fitScore },
    reasonCodes: ['fits_measurements'],
    explanations: [
      f.bestSize && f.bestSize !== 'Unknown' ? `Fits you in size ${f.bestSize}` : 'Fits your measurements',
    ],
  }));
}
