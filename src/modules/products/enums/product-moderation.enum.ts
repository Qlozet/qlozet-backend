/**
 * Platform moderation state, distinct from the vendor-owned `status`.
 *
 * `status` answers "does the vendor want this listed?" (active / draft /
 * archived / scheduled). Moderation answers "will the platform allow it?" —
 * the admin catalogue's Approve / Reject actions. A product needs both:
 * ACTIVE status and a non-rejected moderation state, to reach customers.
 */
export enum ProductModerationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
