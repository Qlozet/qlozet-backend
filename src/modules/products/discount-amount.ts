/**
 * How much a discount takes off a price. One rule for the catalogue (the sale
 * price shown on a listing) and checkout (the price charged for a
 * customizable item), so they cannot disagree.
 *
 * Checkout used to treat every store-wide discount as a percentage, so a
 * store-wide N500 off became 500% off and the item cost N0. Store-wide and
 * category discounts carry `value_type` to say which they are.
 *
 * Never more than the price, never below zero.
 */
export function discountAmount(price: number, discount: any): number {
  if (!discount || !(price > 0)) return 0;
  const value = Math.max(0, Number(discount.value) || 0);
  const percentOf = (pct: number) => (price * Math.min(pct, 100)) / 100;

  let amount: number;
  switch (discount.type) {
    case 'percentage':
    case 'flash_percentage':
      amount = percentOf(value);
      break;
    case 'fixed':
    case 'flash_fixed':
      amount = value;
      break;
    case 'store_wide':
      // Older store-wide discounts have no value_type and were percentages.
      amount = discount.value_type === 'fixed' ? value : percentOf(value);
      break;
    case 'category_specific':
      amount = discount.value_type === 'percentage' ? percentOf(value) : value;
      break;
    default:
      amount = 0;
  }
  return Math.min(Math.max(amount, 0), price);
}
