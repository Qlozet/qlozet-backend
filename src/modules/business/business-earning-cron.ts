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
import {
  Transaction,
  TransactionDocument,
  TransactionType,
  TransactionStatus,
} from '../transactions/schema/transaction.schema';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';

@Injectable()
export class BusinessEarningsCron {
  private readonly logger = new Logger(BusinessEarningsCron.name);

  // Fallback window: if the delivery webhook never fires, completion earnings
  // would otherwise sit unreleasable forever. Auto-release them this many days
  // after the vendor DISPATCHED the order (shipped_at), not after payment — so
  // production time isn't baked in and the window can be short. Only fires when
  // the order is in flight and not cancelled/returned. Overridable via
  // PlatformSettings.auto_release_days.
  private readonly DEFAULT_AUTO_RELEASE_DAYS = 10;

  constructor(
    @InjectModel(BusinessEarning.name)
    private readonly businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(Wallet.name)
    private readonly businessWalletModel: Model<WalletDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
  ) {}

  /**
   * Write a CREDIT transaction to the vendor's wallet ledger when an earning is
   * released into their spendable balance. This is what makes vendor income show
   * up as a *credit* in their transaction history (previously only the
   * customer's order-payment debit was surfaced). Idempotent: keyed on the
   * earning id so a re-run of the release path never double-writes.
   */
  private async recordEarningCredit(
    earning: BusinessEarningDocument,
    walletId: any,
  ) {
    const earningId = (earning._id as any).toString();

    const already = await this.transactionModel.exists({
      'metadata.earning_id': earningId,
      type: TransactionType.CREDIT,
    });
    if (already) return;

    const reference = await generateUniqueQlozetReference(
      this.transactionModel,
      'TRX',
    );

    await this.transactionModel.create({
      wallet: walletId,
      order: earning.order,
      type: TransactionType.CREDIT,
      amount: earning.net_amount,
      reference,
      status: TransactionStatus.SUCCESS,
      channel: 'earning',
      payment_method: 'wallet',
      description: `Earnings released for order`,
      metadata: {
        earning_id: earningId,
        business_id: (earning.business as any)?.toString?.() ?? earning.business,
        milestone: earning.milestone,
      },
    });
  }

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

        // Record the vendor-facing CREDIT so this income shows in their ledger.
        await this.recordEarningCredit(earning, updatedWallet._id);

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
   * money would be stuck forever. Once the order was DISPATCHED long enough ago
   * (shipped_at + auto_release_days) — by which point it has almost certainly
   * been delivered — and the order is not cancelled/returned, schedule the
   * earning so releaseFunds() can pay it out.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async autoReleaseStuckEarnings() {
    const settings = await this.platformSettingsModel.findOne().lean();
    const autoReleaseDays =
      (settings as any)?.auto_release_days ?? this.DEFAULT_AUTO_RELEASE_DAYS;
    const windowMs = autoReleaseDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const stuck = await this.businessEarningsModel.find({
      released: false,
      release_date: null,
    });

    if (!stuck.length) {
      this.logger.log('[AutoRelease] No unscheduled earnings to check.');
      return;
    }

    // Statuses in which auto-release is safe (vendor confirmed; order in flight
    // or already completed). Explicitly excludes pending/in_review (vendor never
    // confirmed), cancelled and returned.
    const eligibleStatuses = new Set(['processing', 'in_transit', 'completed']);
    const dispatchedStatuses = new Set(['shipped', 'in_transit', 'delivered']);

    for (const earning of stuck) {
      try {
        const order = await this.orderModel.findById(earning.order).lean();
        if (!order) continue;
        if (!eligibleStatuses.has((order as any).status)) continue;

        // Anchor on the most recent DISPATCH among this order's shipments.
        // Prefer shipped_at; fall back to confirmed_at for older data. If the
        // order was never dispatched, don't auto-release.
        const shipments = (order as any).shipments || [];
        const dispatchAnchors = shipments
          .filter((s: any) => dispatchedStatuses.has(s.status))
          .map((s: any) => s.shipped_at ?? s.confirmed_at)
          .filter(Boolean)
          .map((d: any) => new Date(d).getTime());

        if (!dispatchAnchors.length) continue;

        const latestDispatch = Math.max(...dispatchAnchors);
        if (latestDispatch + windowMs > now) continue; // not old enough yet

        await this.businessEarningsModel.updateOne(
          { _id: earning._id, released: false, release_date: null },
          { $set: { release_date: new Date() } },
        );

        const daysSince = Math.round((now - latestDispatch) / 86400000);
        this.logger.warn(
          `[AutoRelease] Scheduled stuck ${earning.milestone} earning ${earning._id} ` +
            `(order ${earning.order}, ₦${earning.net_amount}) — dispatched ${daysSince}d ago, ` +
            `delivery webhook likely missed.`,
        );
      } catch (error) {
        this.logger.error(
          `[AutoRelease] Failed for earning ${earning._id}: ${error.message}`,
        );
      }
    }
  }
}
