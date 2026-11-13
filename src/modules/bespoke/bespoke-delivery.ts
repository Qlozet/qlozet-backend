/**
 * Delivery on a bespoke order: priced when the customer accepts a quote and
 * paid with the deposit.
 *
 * The tailor's quote never carries delivery: when they write it the customer
 * may not have chosen an address, so any number would be a guess. At
 * acceptance the address is known, so Qlozet asks the courier service for the
 * price from the tailor's shop to that address, as checkout does for
 * ready-made orders. It is collected with the deposit so it is paid once, up
 * front, and cannot go unpaid with an unpaid balance.
 *
 * Courier prices can move between acceptance and the day the tailor ships;
 * Qlozet absorbs that difference. If no price can be had (no validated
 * address, the courier service down), the order goes ahead with delivery at
 * ₦0 and Qlozet pays the courier, as before this existed: a sale is never
 * lost to a lookup.
 */

/** How long a delivery price is reused for the same quote and address. */
export const DELIVERY_QUOTE_TTL_MS = 20 * 60 * 1000;

/** A finished garment, for the courier's weight and value. */
export const GARMENT_WEIGHT_KG = 1;

export interface BespokeDelivery {
  fee: number;
  courier_id: string | null;
  courier_name: string | null;
  service_code: string | null;
  request_token: string | null;
  /** The courier's own arrival estimate, as it words it. */
  eta: string | null;
  quoted_at: Date;
  /** No price could be had; delivery is ₦0 and Qlozet pays the courier. */
  unpriced: boolean;
  reason: string | null;
}

export const unpricedDelivery = (reason: string): BespokeDelivery => ({
  fee: 0,
  courier_id: null,
  courier_name: null,
  service_code: null,
  request_token: null,
  eta: null,
  quoted_at: new Date(),
  unpriced: true,
  reason,
});

/** The parcel the courier is asked to price. */
export function garmentParcel(name: string, value: number) {
  return {
    name,
    description: name,
    unit_weight: GARMENT_WEIGHT_KG,
    unit_amount: Math.max(0, Math.round(value || 0)),
    quantity: 1,
  };
}

/** Fabric on its way to the tailor, for the courier's weight and value. */
export function fabricParcel(name: string, yards: number, value: number) {
  const y = Number(yards) > 0 ? Number(yards) : 1;
  return {
    name: `${name} — ${y} yd`,
    description: `${name} — ${y} yd`,
    unit_weight: Math.max(0.1, Math.round(y * 0.3 * 100) / 100),
    unit_amount: Math.max(0, Math.round(value || 0)),
    quantity: 1,
  };
}

/**
 * Fabric another shop sends to the tailor for this quote: the main fabric
 * and each extra (contrast, lining, bottom) priced as `other_vendor`. The
 * courier for each leg is charged with the deposit too.
 */
export function fabricLegsOf(quote: any): { product: string; yards: number; amount: number; name: string }[] {
  const legs: { product: string; yards: number; amount: number; name: string }[] = [];
  const all = [quote?.fabric_pricing, ...((quote?.extra_fabric_pricing ?? []) as any[])];
  for (const p of all) {
    if (!p || p.source !== 'other_vendor' || !p.product) continue;
    legs.push({
      product: String(p.product),
      yards: Number(p.yards) || 1,
      amount: Number(p.amount) || 0,
      name: p.name || 'Fabric',
    });
  }
  return legs;
}

/** The cheapest courier in a rate response, or null when none was offered. */
export function cheapestCourier(rates: any): any | null {
  const couriers: any[] = Array.isArray(rates?.couriers) ? rates.couriers : [];
  const priced = couriers.filter((c) => Number(c?.total) > 0);
  if (priced.length) {
    return priced.reduce((a, b) => (Number(b.total) < Number(a.total) ? b : a));
  }
  return Number(rates?.cheapest_courier?.total) > 0 ? rates.cheapest_courier : null;
}

/** A delivery price from a courier rate response. */
export function deliveryFromRates(rates: any, now = new Date()): BespokeDelivery {
  const courier = cheapestCourier(rates);
  if (!courier) return unpricedDelivery('No courier offered a price for this route.');
  return {
    fee: Math.round(Number(courier.total)),
    courier_id: courier.courier_id != null ? String(courier.courier_id) : null,
    courier_name: courier.courier_name ?? null,
    service_code: courier.service_code ?? null,
    request_token: rates?.request_token ?? null,
    eta: courier.delivery_eta ?? null,
    quoted_at: now,
    unpriced: false,
    reason: null,
  };
}
