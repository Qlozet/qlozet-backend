// Server-side purchase-signal emission.
//
// `purchase` is the highest-weighted event in the recommender (5.0 in both the
// trending aggregation and the user style vector) but no client ever fired it —
// the strongest signal was dead. It is emitted SERVER-SIDE at order
// finalisation so every payment rail (Paystack, Stripe, wallet) and every
// client (web, mobile) is covered by one implementation.
//
// Personalisation keys on `properties.itemId`, so that field is the one that
// must always be present.

/** One `purchase` event document per order item, ready for insertMany. */
export function buildPurchaseEvents(order: any): any[] {
  const customerId = order?.customer?.toString?.();
  const items: any[] = order?.items ?? [];
  if (!customerId || !items.length) return [];

  const now = new Date();
  return items
    .filter((i) => i?.product)
    .map((i) => ({
      userId: customerId,
      eventType: 'purchase',
      properties: {
        itemId: i.product.toString(),
        price: i.total_price ?? 0,
        quantity: i.quantity ?? 1,
      },
      context: { surface: 'checkout' },
      metadata: { order_reference: order?.reference },
      timestamp: now,
    }));
}
