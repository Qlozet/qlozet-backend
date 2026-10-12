import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BespokeQuote, BespokeQuoteStatus } from './schemas/bespoke-quote.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { VendorRecipientsService } from '../notifications/vendor-recipients.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { QUOTE_ROLES } from './bespoke.service';

/** A request unanswered this long gets a nudge. */
export const QUOTE_REMINDER_AFTER_HOURS = 24;
/** Past this age the request has expired or will shortly; stop nudging. */
const QUOTE_REMINDER_MAX_AGE_DAYS = 7;

/**
 * Nudges tailors about quote requests they have not answered.
 *
 * The request notification fires once, when the customer asks. A tailor who
 * misses it hears nothing more, and a request left a day or two is usually
 * lost to another tailor. This sends one reminder per quote while it stays
 * unanswered - deduped on quote_id by createUnique, so a tailor who has not
 * read the last reminder is not stacked with more - with "Ask assistant" on
 * the notification leading straight to pricing help.
 */
@Injectable()
export class BespokeRemindersCron {
  private readonly logger = new Logger(BespokeRemindersCron.name);

  constructor(
    @InjectModel(BespokeQuote.name) private readonly quoteModel: Model<BespokeQuote>,
    private readonly notifications: NotificationsService,
    private readonly vendorRecipients: VendorRecipientsService,
  ) {}

  // 09:00 server time, daily: early enough to act on the same day.
  @Cron('0 9 * * *')
  async run() {
    try {
      const res = await this.remindUnansweredQuoteRequests();
      this.logger.log(`[QuoteReminders] waiting=${res.waiting} notified=${res.notified}`);
    } catch (err: any) {
      this.logger.error(`[QuoteReminders] failed: ${err?.message}`);
    }
  }

  async remindUnansweredQuoteRequests(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - QUOTE_REMINDER_AFTER_HOURS * 3_600_000);
    const oldest = new Date(now.getTime() - QUOTE_REMINDER_MAX_AGE_DAYS * 86_400_000);
    const waiting: any[] = await this.quoteModel
      .find({ status: BespokeQuoteStatus.PENDING, createdAt: { $lt: cutoff, $gt: oldest } })
      .select('reference vendor design createdAt')
      .populate({ path: 'design', select: 'name' })
      .lean();

    const byVendor = new Map<string, any[]>();
    for (const q of waiting) {
      const v = String(q.vendor ?? '');
      if (!v) continue;
      byVendor.set(v, [...(byVendor.get(v) ?? []), q]);
    }

    let notified = 0;
    for (const [vendorId, quotes] of byVendor) {
      let recipients: { userId: Types.ObjectId | string }[] = [];
      try {
        recipients = await this.vendorRecipients.resolve(vendorId, QUOTE_ROLES);
      } catch (err: any) {
        this.logger.warn(`[QuoteReminders] recipients for ${vendorId} failed: ${err?.message}`);
        continue;
      }
      for (const q of quotes) {
        const hours = Math.round((now.getTime() - new Date(q.createdAt).getTime()) / 3_600_000);
        const design = q.design?.name ?? 'a design';
        for (const member of recipients) {
          try {
            const created = await this.notifications.createUnique(
              {
                recipient: member.userId as any,
                recipient_business: vendorId,
                category: NotificationCategory.BESPOKE,
                type: NotificationType.BESPOKE_QUOTE_REQUEST,
                title: 'A quote request is still waiting',
                body: `"${design}" has waited ${hours} hours for your quote. Requests left unanswered are usually lost to another tailor.`,
                metadata: {
                  quote_id: String(q._id),
                  quote_reference: q.reference,
                  design_id: q.design?._id ? String(q.design._id) : undefined,
                  design_name: q.design?.name,
                  waiting_hours: hours,
                  reminder: true,
                },
                action_url: '/orders?tab=quotes',
              } as any,
              'quote_id',
            );
            if (created) notified++;
          } catch (err: any) {
            this.logger.warn(`[QuoteReminders] notify failed: ${err?.message}`);
          }
        }
      }
    }
    return { waiting: waiting.length, notified };
  }
}
