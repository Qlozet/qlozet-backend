import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from './schemas/orders.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { FIT_PROMPT_MAX_AGE_DAYS, fitPromptDue } from './order-again';

/**
 * Asks once how a made-to-measure piece fit, a few days after it arrives.
 *
 * The fit card on the order was only found by customers who went looking.
 * One polite question, never repeated: `fit_prompt_sent_at` is claimed
 * before the notification goes out, so a second run (or a second machine)
 * can't ask again. Answering stays on the order; the card shows until then.
 */
@Injectable()
export class FitPromptCron {
  private readonly logger = new Logger(FitPromptCron.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly notifications: NotificationsService,
  ) {}

  // 11:00 server time, daily: a time people read their phone.
  @Cron('0 11 * * *')
  async run() {
    try {
      const res = await this.askHowItFit();
      this.logger.log(`[FitPrompt] candidates=${res.candidates} asked=${res.asked}`);
    } catch (err: any) {
      this.logger.error(`[FitPrompt] failed: ${err?.message}`);
    }
  }

  async askHowItFit(now: Date = new Date()) {
    // A changed order is touched again, so updatedAt bounds the scan; the
    // exact delivery time is checked in fitPromptDue.
    const oldest = new Date(now.getTime() - (FIT_PROMPT_MAX_AGE_DAYS + 15) * 86_400_000);
    const candidates: any[] = await this.orderModel
      .find({
        status: OrderStatus.COMPLETED,
        payment_status: 'paid',
        fit_feedback: null,
        fit_prompt_sent_at: null,
        updatedAt: { $gte: oldest },
        $or: [{ type: 'bespoke' }, { 'items.clothing_type': 'customize' }],
      })
      .select('reference customer status type items.clothing_type items.business shipments fit_feedback fit_prompt_sent_at updatedAt')
      .populate({ path: 'items.business', select: 'business_name' })
      .lean();

    let asked = 0;
    for (const order of candidates) {
      if (!fitPromptDue(order, now)) continue;
      const claimed = await this.orderModel.updateOne(
        { _id: order._id, fit_prompt_sent_at: null, fit_feedback: null },
        { $set: { fit_prompt_sent_at: now } },
      );
      if (!claimed.modifiedCount) continue;

      const fitted: any =
        (order.items || []).find((i: any) => i?.clothing_type === 'customize') ??
        order.items?.[0];
      const store: string | undefined = fitted?.business?.business_name;
      try {
        await this.notifications.create({
          recipient: String(order.customer),
          audience: 'customer',
          category: NotificationCategory.ORDER,
          type: NotificationType.FIT_FEEDBACK_REQUEST,
          title: 'How did it fit?',
          body: store
            ? `Tell us how your piece from ${store} fit. It takes a few seconds and helps your next order fit better.`
            : 'Tell us how your piece fit. It takes a few seconds and helps your next order fit better.',
          metadata: { order_id: order._id, order_reference: order.reference },
          action_url: `/profile?tab=orders&order=${encodeURIComponent(order.reference)}&view=fit`,
        } as any);
        asked++;
      } catch (err: any) {
        this.logger.warn(`[FitPrompt] notify ${order.reference} failed: ${err?.message}`);
      }
    }
    return { candidates: candidates.length, asked };
  }
}
