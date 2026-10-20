import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { MailService } from './mail/mail.service';
import { VendorRecipientsService } from './vendor-recipients.service';
import {
  NotificationCategory,
  NotificationType,
} from './schemas/notification.schema';

export type VerificationOutcome = 'approved' | 'action_required' | 'rejected';

const TITLES: Record<VerificationOutcome, string> = {
  approved: 'Your store is approved',
  action_required: 'Your verification needs attention',
  rejected: 'Your store was not approved',
};

/**
 * Tells a vendor how their store verification ended: an admin decision, or
 * the identity provider's checks failing.
 *
 * Verification is the owner's job (the Verification tab is owner-only), so
 * the owner is the recipient; VendorRecipientsService always includes them.
 * In-app notification plus email, both best-effort: telling the vendor must
 * never fail the decision itself.
 */
@Injectable()
export class VendorVerificationNotifier {
  private readonly logger = new Logger(VendorVerificationNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly recipients: VendorRecipientsService,
    @InjectModel('Business') private readonly businessModel: Model<any>,
  ) {}

  async notify(
    businessId: string | Types.ObjectId,
    outcome: VerificationOutcome,
    message?: string | null,
  ): Promise<void> {
    try {
      const id = String(businessId);
      const [owners, business] = await Promise.all([
        this.recipients.resolve(id, []),
        this.businessModel.findById(id).select('business_name').lean<any>(),
      ]);
      if (!owners.length) return;

      const businessName = business?.business_name || 'your store';
      const body =
        outcome === 'approved'
          ? `${businessName} is approved. You can now take orders.`
          : (message?.trim() ||
            (outcome === 'rejected'
              ? 'Contact support to find out what is needed to reopen your verification.'
              : 'One of your verification checks did not pass. Open verification to see what to do.'));

      await Promise.all(
        owners.map(async (r) => {
          await this.notifications
            .create({
              recipient: r.userId,
              recipient_business: id,
              category: NotificationCategory.SYSTEM,
              type: NotificationType.VERIFICATION_DECISION,
              title: TITLES[outcome],
              body,
              metadata: { business_id: id, outcome },
              action_url:
                outcome === 'approved' ? '/dashboard' : '/settings?tab=verification',
            })
            .catch((e: any) =>
              this.logger.warn(`Verification notification failed: ${e?.message}`),
            );
          if (r.email) {
            await this.mail
              .sendVendorVerificationEmail(
                r.email,
                r.name || 'there',
                businessName,
                outcome,
                body,
              )
              .catch((e: any) =>
                this.logger.warn(`Verification email failed: ${e?.message}`),
              );
          }
        }),
      );
    } catch (err: any) {
      this.logger.warn(
        `Verification notice for business ${String(businessId)} failed: ${err?.message}`,
      );
    }
  }
}
