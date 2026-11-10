import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TokenService } from '../wallets/token.service';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { ReturnStatus } from '../returns/schemas/return.schema';
import { DisputeStatus } from '../disputes/schemas/dispute.schema';
import { REWARD_LOOKBACK_DAYS, rewardBlock } from './order-token-reward';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Earlier code paid this at payment; an order rewarded then is never paid again. */
export const LEGACY_REWARD_FEATURE = 'reward:order_payment';
export const REWARD_FEATURE = 'reward:order_completed';

const OPEN_RETURN = [
  ReturnStatus.REQUESTED,
  ReturnStatus.VENDOR_APPROVED,
  ReturnStatus.RETURN_SHIPPED,
  ReturnStatus.RECEIVED,
];
const OPEN_DISPUTE = [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];

/**
 * Pays the order token reward once the order is delivered and its return
 * window has closed (rules in order-token-reward.ts). Runs hourly; each order
 * is claimed with one atomic write before the grant, so an overlapping run
 * can't pay twice.
 */
@Injectable()
export class OrderTokenRewardCron {
  private readonly logger = new Logger(OrderTokenRewardCron.name);

  constructor(
    private readonly tokenService: TokenService,
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('Return') private readonly returnModel: Model<any>,
    @InjectModel('Dispute') private readonly disputeModel: Model<any>,
    @InjectModel('TokenTransaction')
    private readonly tokenTransactionModel: Model<any>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(now: Date = new Date()): Promise<number> {
    const settings: any = await this.platformSettingsModel.findOne().lean();
    const reward = Number(settings?.order_payment_token_reward ?? 0);
    if (!reward || reward <= 0) return 0;
    const returnWindowDays = Number(settings?.return_window_days ?? 7);

    // Delivered between (window + lookback) and (window) days ago. No batch
    // limit: the date range keeps this small, and a limit could fill up with
    // orders that are blocked for good.
    const latest = new Date(now.getTime() - returnWindowDays * DAY_MS);
    const earliest = new Date(latest.getTime() - REWARD_LOOKBACK_DAYS * DAY_MS);
    const candidates = await this.orderModel
      .find({
        status: 'completed',
        payment_status: 'paid',
        refund_status: { $ne: 'refunded' },
        token_reward_granted_at: null,
        'shipments.delivered_at': { $gte: earliest, $lte: latest },
      })
      .lean();

    let paid = 0;
    for (const order of candidates) {
      try {
        if (await this.rewardOne(order, reward, returnWindowDays, now)) paid++;
      } catch (e: any) {
        this.logger.warn(
          `Order token reward failed for ${order?.reference}: ${e?.message}`,
        );
      }
    }
    if (paid)
      this.logger.log(
        `Order token reward: paid ${paid} order(s) ${reward} tokens each`,
      );
    return paid;
  }

  private async rewardOne(
    order: any,
    reward: number,
    returnWindowDays: number,
    now: Date,
  ): Promise<boolean> {
    // Older records store the order id as a string. Query the raw collections:
    // through the model, the string in $in would be cast to an ObjectId and
    // those records would be missed.
    const orderRef = { $in: [order._id, String(order._id)] };
    const has = (model: Model<any>, status: any) =>
      model.collection.findOne(
        { order: orderRef, status },
        { projection: { _id: 1 } },
      );
    const [openReturn, openDispute, fullDisputeRefund, legacy] =
      await Promise.all([
        has(this.returnModel, { $in: OPEN_RETURN }),
        has(this.disputeModel, { $in: OPEN_DISPUTE }),
        has(this.disputeModel, DisputeStatus.RESOLVED_REFUND),
        this.tokenTransactionModel.exists({
          feature: LEGACY_REWARD_FEATURE,
          'metadata.order': order.reference,
        }),
      ]);

    const block = rewardBlock(order, {
      now,
      returnWindowDays,
      openReturn: !!openReturn,
      openDispute: !!openDispute,
      fullDisputeRefund: !!fullDisputeRefund,
    });
    if (block) return false;

    const customerId = order?.customer?.toString();
    if (!customerId) return false;

    // Claim first, so a second run can't pay the same order.
    const claimed = await this.orderModel.updateOne(
      { _id: order._id, token_reward_granted_at: null },
      { $set: { token_reward_granted_at: now } },
    );
    if (!claimed.modifiedCount) return false;

    // Already rewarded at payment by the old code: keep the claim, pay nothing.
    if (legacy) return false;

    try {
      await this.tokenService.grant(
        { customer: customerId },
        reward,
        REWARD_FEATURE,
        {
          order: order.reference,
        },
      );
    } catch (e) {
      // Release the claim so the next run tries again.
      await this.orderModel.updateOne(
        { _id: order._id },
        { $set: { token_reward_granted_at: null } },
      );
      throw e;
    }
    return true;
  }
}
