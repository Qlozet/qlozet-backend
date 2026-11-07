// Which orders the admin console counts as orders: ones the customer paid for.
//
// A card checkout creates the order before the charge, so a failed or
// abandoned payment leaves a pending, unpaid order behind. Counting those made
// the dashboard's orders, top products, charts and each customer's order count
// grow with every abandoned checkout. Fabric-reservation fee orders are a
// platform fee, not a sale, so they are left out too (as vendorOrderScope does).
//
// Money figures (gross sales, revenue, commission) already match on
// payment_status: 'paid' and are unchanged.

export const ADMIN_COUNTED_ORDER = {
  payment_status: 'paid',
  type: { $ne: 'reservation' },
} as const;

/** The same rule as an aggregation expression, for a $cond inside a $group. */
export const IS_ADMIN_COUNTED_ORDER = {
  $and: [
    { $eq: ['$payment_status', 'paid'] },
    { $ne: ['$type', 'reservation'] },
  ],
};
