/**
 * The switches a person can flip for push notifications, per app.
 *
 * Transactional messages (orders and delivery, money, account and support)
 * are locked on: someone who turns off "my parcel is out for delivery"
 * misses the parcel. The rest can be turned off. Preferences decide PUSH
 * only; every notification still lands in the in-app inbox, which is the
 * record. Keep the labels in step with the push handoff guide.
 */
export type PushAudience = 'customer' | 'vendor';

export interface PushSwitch {
  key: string;
  label: string;
  description: string;
  locked: boolean;
}

export const PUSH_SWITCHES: Record<PushAudience, PushSwitch[]> = {
  customer: [
    { key: 'orders', label: 'Orders and delivery', description: 'Confirmations, dispatch, delivery, refunds, returns and problems.', locked: true },
    { key: 'payments', label: 'Payments and wallet', description: 'Payments, refunds to your wallet and failed payments.', locked: true },
    { key: 'account', label: 'Account and support', description: 'Security notices and replies from support.', locked: true },
    { key: 'bespoke', label: 'Quotes and bespoke', description: 'New quotes and updates on your designs.', locked: false },
    { key: 'messages', label: 'Messages from tailors', description: 'When a tailor writes about your order.', locked: false },
    { key: 'product', label: 'Price drops and stock', description: 'Things you saved going on sale or back in stock.', locked: false },
    { key: 'announcements', label: 'News and offers', description: 'New collections and offers from Qlozet.', locked: false },
  ],
  vendor: [
    { key: 'orders', label: 'Orders', description: 'New orders, cancellations, deadlines, returns and disputes.', locked: true },
    { key: 'payments', label: 'Payouts', description: 'Money released, held or taken back.', locked: true },
    { key: 'account', label: 'Account and support', description: 'Verification, security and replies from support.', locked: true },
    { key: 'bespoke', label: 'Quote requests', description: 'New bespoke requests and quote decisions.', locked: false },
    { key: 'messages', label: 'Customer messages', description: 'When a customer writes about an order.', locked: false },
    { key: 'product', label: 'Listings and stock', description: 'Review decisions and low-stock alerts.', locked: false },
    { key: 'team', label: 'Team', description: 'People joining or leaving your team.', locked: false },
    { key: 'announcements', label: 'News from Qlozet', description: 'Announcements to vendors.', locked: false },
  ],
};

/** The switch a notification falls under. */
export function switchFor(n: { type?: string; category?: string }): string {
  if (n.type === 'announcement') return 'announcements';
  if (n.type === 'new_message') return 'messages';
  // A tailor asking about measurements needs an answer before cutting.
  if (n.type === 'measurement_question') return 'orders';
  switch (n.category) {
    case 'order':
    case 'shipping':
      return 'orders';
    case 'payment':
      return 'payments';
    case 'bespoke':
      return 'bespoke';
    case 'product':
      return 'product';
    case 'team':
      return 'team';
    default:
      return 'account';
  }
}

/** Whether a push may go out under these preferences. Missing = on. */
export function pushAllowed(
  prefs: Record<string, any> | null | undefined,
  audience: PushAudience,
  n: { type?: string; category?: string },
): boolean {
  const key = switchFor(n);
  const sw = PUSH_SWITCHES[audience].find((s) => s.key === key);
  if (!sw || sw.locked) return true;
  return prefs?.[audience]?.[key] !== false;
}

/** The switches for one app, with this person's current settings. */
export function preferencesView(prefs: Record<string, any> | null | undefined, audience: PushAudience) {
  return PUSH_SWITCHES[audience].map((s) => ({
    ...s,
    enabled: s.locked ? true : prefs?.[audience]?.[s.key] !== false,
  }));
}
