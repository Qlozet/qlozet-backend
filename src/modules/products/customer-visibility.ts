/**
 * Which products a customer may see or buy.
 *
 * Review first: a listing reaches shoppers only once Qlozet has approved it.
 * New and resubmitted listings are 'pending' and stay out of the shop;
 * rejected ones too. Products that predate moderation carry no moderation
 * field at all and stay visible, so turning this on did not empty the shop.
 *
 * Every customer-facing read uses these, so the shop, storefronts, search,
 * the stylist, recommendations, wishlists, size-guide matches, cart and
 * checkout all agree. (The vendor-approval gate is separate and still
 * applies on top.)
 */

/** Matches 'approved', or no moderation at all (`{ 'a.b': null }` matches missing). */
export const CUSTOMER_VISIBLE_MODERATION = { $in: ['approved', null] };

/** The Mongo filter for a product a customer may see. */
export const customerVisibleProductFilter = () => ({
  status: 'active',
  'moderation.status': CUSTOMER_VISIBLE_MODERATION,
});

/** The same rule for a product already loaded. */
export const isApprovedForCustomers = (product: any): boolean => {
  const status = product?.moderation?.status;
  return !status || status === 'approved';
};

export const isCustomerVisible = (product: any): boolean =>
  product?.status === 'active' && isApprovedForCustomers(product);
