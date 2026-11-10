/**
 * When an order earns the customer its token reward
 * (`order_payment_token_reward`, 0 = off).
 *
 * Not at payment: an order that is cancelled or refunded would keep the
 * tokens, so ordering and cancelling could be repeated for free tokens.
 * The reward waits until the customer has the order and can no longer send
 * it back: every parcel delivered, then the return window closed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Orders whose return window closed longer ago than this are left alone, so
 * switching the reward on doesn't pay out for every old order at once.
 */
export const REWARD_LOOKBACK_DAYS = 30;

/** Shipments the customer receives (not rejected, not a fabric hand-off between vendors). */
const customerParcels = (order: any) =>
  (order?.shipments || []).filter(
    (s: any) => !s?.rejected && s?.shipment_type !== 'fabric_transfer',
  );

/**
 * The moment the reward is due: the last parcel's delivery plus the return
 * window. null while any parcel is still on its way, or nothing was delivered.
 */
export function rewardDueAt(order: any, returnWindowDays: number): Date | null {
  const parcels = customerParcels(order);
  if (!parcels.length) return null;
  let last = 0;
  for (const p of parcels) {
    const t = p?.delivered_at ? new Date(p.delivered_at).getTime() : 0;
    if (!t) return null;
    if (t > last) last = t;
  }
  return new Date(last + Math.max(0, returnWindowDays) * DAY_MS);
}

export type RewardBlock =
  | 'already_rewarded'
  | 'not_paid'
  | 'not_completed'
  | 'refunded'
  | 'not_delivered'
  | 'window_open'
  | 'too_old'
  | 'open_return'
  | 'open_dispute'
  | 'refunded_by_dispute';

/** Why an order can't be rewarded yet (or ever), or null when it can. */
export function rewardBlock(
  order: any,
  ctx: {
    now: Date;
    returnWindowDays: number;
    openReturn: boolean;
    openDispute: boolean;
    fullDisputeRefund: boolean;
  },
): RewardBlock | null {
  if (order?.token_reward_granted_at) return 'already_rewarded';
  if (order?.payment_status !== 'paid') return 'not_paid';
  if (order?.status !== 'completed') return 'not_completed';
  if (order?.refund_status === 'refunded') return 'refunded';
  const due = rewardDueAt(order, ctx.returnWindowDays);
  if (!due) return 'not_delivered';
  if (ctx.now < due) return 'window_open';
  if (ctx.now.getTime() - due.getTime() > REWARD_LOOKBACK_DAYS * DAY_MS)
    return 'too_old';
  if (ctx.openReturn) return 'open_return';
  if (ctx.openDispute) return 'open_dispute';
  if (ctx.fullDisputeRefund) return 'refunded_by_dispute';
  return null;
}
