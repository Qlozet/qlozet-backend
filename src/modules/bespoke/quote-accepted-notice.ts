import { VendorRole } from '../ums/schemas/role.schema';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

/**
 * Tell the tailor their quote was accepted and paid for, so they can start.
 *
 * The type existed but nothing sent it: the tailor found out only by opening
 * their orders. Called by both payment paths (wallet in BespokeService, card in
 * WebhookService), each of which runs it once per acceptance.
 */
export async function notifyQuoteAccepted(
  deps: {
    notificationsService: { create: (data: any) => Promise<any> };
    vendorRecipients: { resolve: (business: string, roles: VendorRole[]) => Promise<{ userId: string }[]> };
    logger: { warn: (msg: string) => void };
  },
  args: {
    tailorId: string;
    orderId: string;
    orderReference: string;
    quoteId: string;
    quoteTotal: number;
    /** What the customer paid towards the tailor's work now; null = paid in full. */
    depositAmount: number | null;
  },
): Promise<void> {
  const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`;
  const paid =
    args.depositAmount != null && args.depositAmount < args.quoteTotal
      ? `The customer paid the ${naira(args.depositAmount)} deposit; the balance is due when you send photos of the finished piece.`
      : `The customer paid the full ${naira(args.quoteTotal)}.`;
  try {
    const members = await deps.vendorRecipients.resolve(args.tailorId, [VendorRole.TAILOR]);
    await Promise.all(
      members.map((member) =>
        deps.notificationsService
          .create({
            recipient: member.userId,
            recipient_business: args.tailorId,
            category: NotificationCategory.BESPOKE,
            type: NotificationType.BESPOKE_QUOTE_ACCEPTED,
            title: 'Quote accepted - you can start',
            body: `Your ${naira(args.quoteTotal)} quote was accepted (order #${args.orderReference}). ${paid}`,
            metadata: {
              order_id: args.orderId,
              order_reference: args.orderReference,
              quote_id: args.quoteId,
              quote_total: args.quoteTotal,
              deposit_amount: args.depositAmount,
            },
            action_url: '/orders',
          })
          .catch((err: any) =>
            deps.logger.warn(`Failed to send quote-accepted notice: ${err?.message}`),
          ),
      ),
    );
  } catch (err: any) {
    deps.logger.warn(`Failed to resolve tailor for quote-accepted notice: ${err?.message}`);
  }
}
