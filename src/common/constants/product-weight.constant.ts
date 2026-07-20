/**
 * Default parcel weights (kg) used to estimate Shipbubble shipping rates when a
 * product carries no explicit weight. Keyed by product `kind`. These are
 * fashion-catalogue averages — good enough to quote realistic rates instead of
 * a flat 1 kg for every parcel.
 *
 * If/when a per-product `weight_kg` field is introduced, prefer that value and
 * fall back to these defaults.
 */
export const DEFAULT_PACKAGE_WEIGHT_KG = 1;

export const PRODUCT_WEIGHT_BY_KIND_KG: Record<string, number> = {
  clothing: 0.75,
  fabric: 1.5,
  accessory: 0.4,
};

/**
 * Estimate the shipping weight (kg) of a product.
 * For fabric, weight scales with the ordered yardage (~0.3 kg/yard) when known.
 */
export function estimateProductWeightKg(
  product: { kind?: string; weight_kg?: number } | null | undefined,
  opts?: { yards?: number },
): number {
  if (product?.weight_kg && product.weight_kg > 0) {
    return product.weight_kg;
  }

  const kind = product?.kind ?? '';

  if (kind === 'fabric' && opts?.yards && opts.yards > 0) {
    return Math.max(0.3, Math.ceil(opts.yards * 0.3));
  }

  return PRODUCT_WEIGHT_BY_KIND_KG[kind] ?? DEFAULT_PACKAGE_WEIGHT_KG;
}
