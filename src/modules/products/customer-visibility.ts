/**
 * Which products a customer may see or buy.
 *
 * The admin picks how new listings reach the shop (platform setting
 * `listing_review_mode`):
 *
 * - 'review_first' (default): a listing reaches shoppers only once Qlozet has
 *   approved it. New and resubmitted listings are 'pending' and stay hidden.
 * - 'live_first': a published listing shows straight away while it waits in
 *   the review queue; only a rejection takes it down.
 *
 * Rejected listings are hidden in both modes. Products that predate
 * moderation carry no moderation field and are visible in both.
 *
 * Every customer-facing read uses these, so the shop, storefronts, search,
 * the stylist, recommendations, wishlists, size-guide matches, cart and
 * checkout all agree. (The vendor-approval gate is separate and still
 * applies on top.)
 *
 * The mode is held here so query builders can stay synchronous.
 * PlatformService sets it on boot, on every settings read and save, and on a
 * one-minute refresh, so every machine follows a change within a minute.
 */

export type ListingReviewMode = 'review_first' | 'live_first';

export const LISTING_REVIEW_MODES: ListingReviewMode[] = [
  'review_first',
  'live_first',
];

let mode: ListingReviewMode = 'review_first';

export const setListingReviewMode = (next: unknown): void => {
  mode = next === 'live_first' ? 'live_first' : 'review_first';
};

export const getListingReviewMode = (): ListingReviewMode => mode;

/**
 * The `moderation.status` condition for a customer-visible product. Field
 * level, so it never clashes with a query's own `$or`.
 * (`{ 'a.b': null }` also matches a missing field.)
 */
export const customerVisibleModeration = () =>
  mode === 'live_first'
    ? { $ne: 'rejected' }
    : { $in: ['approved', null] };

/** The Mongo filter for a product a customer may see. */
export const customerVisibleProductFilter = () => ({
  status: 'active',
  'moderation.status': customerVisibleModeration(),
});

/** The same rule for a product already loaded. */
export const isApprovedForCustomers = (product: any): boolean => {
  const status = product?.moderation?.status;
  if (!status || status === 'approved') return true;
  return mode === 'live_first' && status !== 'rejected';
};

export const isCustomerVisible = (product: any): boolean =>
  product?.status === 'active' && isApprovedForCustomers(product);
