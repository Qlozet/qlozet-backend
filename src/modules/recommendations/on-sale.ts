/**
 * On sale: a real discounted price below base. The same rule as the product
 * listing's on_sale filter (products.service) and the shop's hasDiscount, so
 * "From the sale, for you" never shows a product the sale list wouldn't.
 */
export function isOnSale(
  p: { base_price?: number; discounted_price?: number } | null | undefined,
): boolean {
  const base = Number(p?.base_price ?? 0);
  const sale = Number(p?.discounted_price ?? 0);
  return sale > 0 && sale < base;
}
