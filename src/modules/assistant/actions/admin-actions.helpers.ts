/**
 * Which prepared actions an admin may propose, by the permission modules
 * their role carries - the same modules that gate the read tools, so an
 * admin who cannot see tickets cannot be offered "assign ticket" either.
 */
export const ADMIN_ACTION_KINDS = [
  'approve_product',
  'reject_product',
  'decide_vendor_application',
  'assign_ticket',
  'reply_to_ticket',
  'resolve_dispute',
  'nudge_vendor',
] as const;
export type AdminActionKind = (typeof ADMIN_ACTION_KINDS)[number];

export const ADMIN_ACTION_MODULES: Record<AdminActionKind, string[]> = {
  approve_product: ['product_management'],
  reject_product: ['product_management'],
  decide_vendor_application: ['vendor_management'],
  assign_ticket: ['support_management'],
  reply_to_ticket: ['support_management'],
  resolve_dispute: ['support_management'],
  nudge_vendor: ['vendor_management', 'product_management'],
};

/** `null` modules = super admin (no role assigned): everything. */
export function permittedAdminActionKinds(modules: Set<string> | null): AdminActionKind[] {
  if (modules === null) return [...ADMIN_ACTION_KINDS];
  return ADMIN_ACTION_KINDS.filter((kind) => ADMIN_ACTION_MODULES[kind].some((m) => modules.has(m)));
}

export function isAdminActionKind(v: unknown): v is AdminActionKind {
  return typeof v === 'string' && (ADMIN_ACTION_KINDS as readonly string[]).includes(v);
}

/** Describe a partial refund sensibly, or say what is wrong with it. */
export function validateRefundAmount(
  resolution: string,
  refundAmount: unknown,
  orderTotal: number,
): { amount: number | null } | { error: string } {
  if (resolution === 'partial_refund') {
    const n = Number(refundAmount);
    if (!(n > 0)) return { error: 'A partial refund needs refund_amount above zero.' };
    if (orderTotal > 0 && n >= orderTotal) return { error: `A partial refund must be below the order total of ${orderTotal}; use full_refund for the whole amount.` };
    return { amount: Math.round(n * 100) / 100 };
  }
  if (resolution === 'full_refund') return { amount: orderTotal > 0 ? orderTotal : null };
  return { amount: null };
}
