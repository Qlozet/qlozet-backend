import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Wallet, WalletDocument } from '../wallets/schema/wallet.schema';
import { Model } from 'mongoose';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from './schemas/business-earnings.schema';
import { Order, OrderDocument } from '../orders/schemas/orders.schema';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';

@Injectable()
export class BusinessEarningsCron {
  private readonly logger = new Logger(BusinessEarningsCron.name);

  // Fallback window: if the delivery webhook never fires, completion earnings
  // would otherwise sit unreleasable forever. Auto-release them this many days
  // after they were recorded, provided the vendor has clearly done their part
  // (order confirmed + at least one shipment dispatched) and the order is not
  // cancelled/returned. Overridable via PlatformSettings.auto_release_days.
  private readonly DEFAULT_AUTO_RELEASE_DAYS = 21;

  constructor(
    @InjectModel(BusinessEarning.name)
    private readonly businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(Wallet.name)
    private readonly businessWalletModel: Model<WalletDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async releaseFunds() {
    const now = new Date();
    this.logger.log(`Running releaseFunds cron at ${now.toISOString()}`);

    const pending = await this.businessEarningsModel.find({
      released: false,
      release_date: { $ne: null, $lte: now }, // Must have a release_date set (set on delivery)
    });

    if (!pending.length) {
      this.logger.log('No pending earnings to release.');
      return;
    }

    this.logger.log(`Found ${pending.length} pending earnings to release.`);

    for (const earning of pending) {
      try {
        this.logger.log(
          `Processing earning for business=${earning.business} | net=${earning.net_amount}`,
        );

        if (!earning.net_amount) {
          this.logger.error(
            `ERROR: net_amount is undefined for earning ${earning._id}`,
          );
          continue;
        }

        // Update business wallet
        const updatedWallet = await this.businessWalletModel.findOneAndUpdate(
          { business: earning.business },
          {
            $inc: {
              balance: earning.net_amount,
              pending_balance: -earning.net_amount,
            },
          },
          { upsert: true, new: true },
        );

        // Mark earning as released
        earning.released = true;
        earning.released_at = new Date();
        await earning.save();

        this.logger.log(
          `Released ₦${earning.net_amount} to business ${earning.business} → wallet=${updatedWallet.balance}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed release for business=${earning.business} order=${earning.order}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Safety net: completion earnings only get a release_date from the delivery
   * webhook. If that webhook never fires (dropped event, test courier), the
   * money would be stuck forever. Once enough time has passed AND the order
   * shows the vendor did their part (confirmed + dispatched) and is not
   * cancelled/returned, schedule the earning so releaseFunds() can pay it out.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async autoReleaseStuckEarnings() {
    const settings = await this.platformSettingsModel.findOne().lean();
    const autoReleaseDays =
      (settings as any)?.auto_release_days ?? this.DEFAULT_AUTO_RELEASE_DAYS;
    const cutoff = new Date(Date.now() - autoReleaseDays * 24 * 60 * 60 * 1000);

    const stuck = await this.businessEarningsModel.find({
      released: false,
      release_date: null,
      createdAt: { $lte: cutoff },
    });

    if (!stuck.length) {
      this.logger.log('[AutoRelease] No stuck earnings to check.');
      return;
    }

    this.logger.log(
      `[AutoRelease] Checking ${stuck.length} earning(s) older than ${autoReleaseDays} days.`,
    );

    // Statuses in which auto-release is safe (vendor confirmed; order in flight
    // or already completed). Explicitly excludes pending/in_review (vendor never
    // confirmed), cancelled and returned.
    const eligibleStatuses = new Set(['processing', 'in_transit', 'completed']);
    const dispatchedStatuses = new Set(['shipped', 'in_transit', 'delivered']);

    for (const earning of stuck) {
      try {
        const order = await this.orderModel.findById(earning.order).lean();
        if (!order) continue;

        if (!eligibleStatuses.has((order as any).status)) {
          continue;
        }

        // Require evidence the vendor dispatched at least one shipment.
        const shipments = (order as any).shipments || [];
        const dispatched = shipments.some((s: any) =>
          dispatchedStatuses.has(s.status),
        );
        if (!dispatched) continue;

        await this.businessEarningsModel.updateOne(
          { _id: earning._id, released: false, release_date: null },
          { $set: { release_date: new Date() } },
        );

        this.logger.warn(
          `[AutoRelease] Scheduled stuck ${earning.milestone} earning ${earning._id} ` +
            `(order ${earning.order}, ₦${earning.net_amount}) — delivery webhook likely missed.`,
        );
      } catch (error) {
        this.logger.error(
          `[AutoRelease] Failed for earning ${earning._id}: ${error.message}`,
        );
      }
    }
  }
}
