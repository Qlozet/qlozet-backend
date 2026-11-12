/**
 * When a vendor must confirm an order by, before it is cancelled.
 *
 * The rule lives in the auto-reject job (OrderService.autoRejectStaleShipments):
 * a shipment still unconfirmed `auto_reject_hours` after the customer paid is
 * rejected and refunded. Orders from before `paid_at` existed count from
 * creation. The vendor app shows this time as a countdown, so it is worked out
 * here once and sent with the order rather than repeated in the app.
 */

export const DEFAULT_CONFIRM_HOURS = 24;

/** The setting as a number of hours; 0 or less means auto-cancel is off. */
export function confirmHoursFrom(settings: any): number {
  const raw = Number(settings?.auto_reject_hours ?? DEFAULT_CONFIRM_HOURS);
  return Number.isFinite(raw) ? raw : DEFAULT_CONFIRM_HOURS;
}

/** When the clock started for this order: payment, else creation. */
export function confirmClockStart(order: any): Date | null {
  const start = order?.paid_at ?? order?.createdAt;
  const date = start ? new Date(start) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** A shipment that is still waiting on its vendor to confirm. */
export function awaitingConfirmation(order: any, shipment: any): boolean {
  return (
    order?.status === 'in_review' &&
    !!shipment &&
    !shipment.confirmed &&
    !shipment.rejected
  );
}

/** The confirm-by time for one shipment, or null when none applies. */
export function confirmByFor(order: any, shipment: any, hours: number): Date | null {
  if (!(hours > 0) || !awaitingConfirmation(order, shipment)) return null;
  const start = confirmClockStart(order);
  return start ? new Date(start.getTime() + hours * 3_600_000) : null;
}

/**
 * The order as a vendor sees it, with `confirm_by` on each shipment still
 * waiting for confirmation and, at the top, the earliest one that is theirs
 * (as the seller or as the fabric shop sending a transfer).
 */
export function withConfirmBy<T extends Record<string, any>>(
  order: T,
  businessId: string,
  hours: number,
): T {
  if (!order || !Array.isArray(order.shipments)) return order;
  let mine: Date | null = null;
  const shipments = order.shipments.map((s: any) => {
    const by = confirmByFor(order, s, hours);
    if (by && String(s?.business?._id ?? s?.business) === String(businessId)) {
      if (!mine || by < mine) mine = by;
    }
    return by ? { ...s, confirm_by: by } : s;
  });
  return { ...order, shipments, confirm_by: mine };
}

/** How long before the deadline to warn: 4 hours, or a quarter of a short window. */
export function confirmWarningLeadHours(hours: number): number {
  return Math.min(4, hours / 4);
}
