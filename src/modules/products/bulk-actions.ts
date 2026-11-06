import { ProductStatus } from './enums/product-status.enum';
import { findListingViolations, listingCandidateFor } from './listing-rules';

/**
 * Acting on several of a vendor's products at once, from the Products tables.
 *
 * - activate: puts the listing on sale. Each product must clear the same
 *   floor as publishing from the edit form (price above zero plus the listing
 *   rules), so a bulk action can never put a half-finished draft in the shop.
 *   Those that fail are skipped and named, with the reason, rather than
 *   failing the whole batch.
 * - archive: takes it off sale. It stays in the vendor's list and can be
 *   activated again.
 * - delete: takes it off sale AND out of the vendor's list. The record is
 *   kept (deleted_at) because orders, carts, returns and reservations point
 *   at it; only the vendor stops seeing it.
 */

export const BULK_PRODUCT_ACTIONS = ['activate', 'archive', 'delete'] as const;
export type BulkProductAction = (typeof BULK_PRODUCT_ACTIONS)[number];

export const MAX_BULK_PRODUCTS = 100;

export interface BulkSkip {
  id: string;
  name: string;
  reason: string;
}

export interface BulkPlan {
  apply: string[];
  skipped: BulkSkip[];
}

const nameOf = (p: any): string =>
  p?.[p?.kind]?.name || p?.seo?.title || 'Untitled product';

/** Why this product cannot go on sale, or [] when it can. */
export function activationProblems(product: any): string[] {
  const problems: string[] = [];
  if (!(Number(product?.base_price) > 0)) {
    problems.push('Set a price above zero first.');
  }
  return problems.concat(
    findListingViolations(
      listingCandidateFor(product?.kind, product?.[product?.kind], product?.seo?.title),
    ),
  );
}

/**
 * Decide, for each requested id, whether the action applies.
 * `found` holds only the vendor's own, not-deleted products, so any id not
 * in it is someone else's, deleted, or never existed - the vendor is told it
 * was not found either way, which reveals nothing about other stores.
 */
export function planBulkAction(
  requestedIds: string[],
  found: any[],
  action: BulkProductAction,
): BulkPlan {
  const byId = new Map(found.map((p) => [String(p._id), p]));
  const apply: string[] = [];
  const skipped: BulkSkip[] = [];

  for (const id of [...new Set(requestedIds.map(String))]) {
    const product = byId.get(id);
    if (!product) {
      skipped.push({ id, name: 'Unknown product', reason: 'Not found in your store.' });
      continue;
    }
    if (action === 'activate') {
      if (product.status === ProductStatus.ACTIVE) {
        skipped.push({ id, name: nameOf(product), reason: 'Already active.' });
        continue;
      }
      const problems = activationProblems(product);
      if (problems.length) {
        skipped.push({ id, name: nameOf(product), reason: problems.join(' ') });
        continue;
      }
    }
    if (action === 'archive' && product.status === ProductStatus.ARCHIVED) {
      skipped.push({ id, name: nameOf(product), reason: 'Already archived.' });
      continue;
    }
    apply.push(id);
  }

  return { apply, skipped };
}
