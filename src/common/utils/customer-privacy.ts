/**
 * What a vendor may know about a customer.
 *
 * Qlozet books the courier (Shipbubble), which already has the full delivery
 * address, so a vendor never needs the street, the phone number or the email
 * to fulfil an order. Giving them out lets a vendor take the customer off
 * Qlozet and is more personal data than the job needs. Vendors get a short
 * name ("Ada O.") and the area (city, state, country); they talk to the
 * customer through the in-app order chat.
 *
 * Shop and admin responses are not passed through here: they keep everything.
 */

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "Ada Obi" → "Ada O."; "Ada" → "Ada"; nothing → "". */
export function shortName(...parts: unknown[]): string {
  const words = parts
    .map(text)
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1].charAt(0).toUpperCase()}.`;
}

/** A delivery address cut down to the area. */
export function addressForVendor(address: any): any {
  if (!address || typeof address !== 'object') return address ?? null;
  const out: Record<string, string> = {};
  const name = shortName(address.full_name);
  if (name) out.full_name = name;
  for (const k of ['city', 'state', 'country'] as const) {
    if (text(address[k])) out[k] = text(address[k]);
  }
  return out;
}

/** A populated customer cut down to a short name (no email or phone). */
export function customerForVendor(customer: any): any {
  if (!customer || typeof customer !== 'object') return customer ?? null;
  // An unpopulated ObjectId: nothing to hide.
  if (
    !('email' in customer) &&
    !('phone_number' in customer) &&
    !('full_name' in customer) &&
    !('firstName' in customer) &&
    !('first_name' in customer)
  ) {
    return customer;
  }
  const first = text(customer.firstName) || text(customer.first_name);
  const last = text(customer.lastName) || text(customer.last_name);
  const name =
    first || last ? shortName(first, last) : shortName(customer.full_name);
  const out: Record<string, any> = { _id: customer._id };
  if (name) {
    out.full_name = name;
    const [f, l] = name.split(' ');
    out.firstName = f;
    if (l) out.lastName = l;
  }
  if (text(customer.username) && !customer.username.includes('@')) {
    out.username = customer.username;
  }
  return out;
}

/** An order as a vendor sees it: area-only address, short-name customer. */
export function orderContactForVendor<T extends Record<string, any>>(
  order: T,
): T {
  if (!order || typeof order !== 'object') return order;
  return {
    ...order,
    ...('address' in order && { address: addressForVendor(order.address) }),
    ...('customer' in order && { customer: customerForVendor(order.customer) }),
  };
}
