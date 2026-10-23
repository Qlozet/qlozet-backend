/**
 * The screen a notification opens, as a path in the app it is for.
 *
 * The same rules as the shop's lib/notification-target.ts (keep the two in
 * step), worked out here once so the website and the phone apps can never
 * disagree: anything about an order opens that order (its delivery timeline
 * for parcel updates, its chat for a tailor's reply), a quote opens its
 * design's quotes, a support reply opens its ticket. A vendor notification
 * keeps the link it was sent with.
 */
export interface RoutableNotification {
  _id?: unknown;
  type: string;
  category?: string;
  action_url?: string | null;
  metadata?: Record<string, unknown> | null;
  audience?: string | null;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const TRACKING_TYPES = new Set(['order_shipped', 'order_status_changed']);

export function notificationRoute(n: RoutableNotification): string | null {
  if (n.audience !== 'customer') {
    return n.action_url && n.action_url.startsWith('/') ? n.action_url : null;
  }
  const m = n.metadata ?? {};
  const orderRef = str(m.order_reference);

  if (n.type === 'bespoke_quote_received') {
    const design = str(m.design_id);
    if (design) return `/bespoke?quotes=${encodeURIComponent(design)}`;
    const quote = str(m.quote_id);
    return quote ? `/bespoke?quote=${encodeURIComponent(quote)}` : '/bespoke';
  }
  if (n.type === 'ticket_reply') {
    const ticket = str(m.ticket_id);
    return ticket ? `/help/tickets?ticket=${encodeURIComponent(ticket)}` : '/help/tickets';
  }
  if (orderRef) {
    const base = `/profile?tab=orders&order=${encodeURIComponent(orderRef)}`;
    if (n.type === 'new_message') return `${base}&view=chat`;
    if (n.category === 'shipping' && TRACKING_TYPES.has(n.type)) return `${base}&view=track`;
    return base;
  }
  return n.action_url && n.action_url.startsWith('/') ? n.action_url : null;
}
