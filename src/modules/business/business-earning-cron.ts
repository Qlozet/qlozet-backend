import { Injectable, Logger, Optional } from '@nestjs/common';
import { SETTLEMENT_DAYS, settlementDate } from './settlement';
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
import { Business, BusinessDocument } from './schemas/business.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../notifications/mail/mail.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Dispute, DisputeDocument } from '../disputes/schemas/dispute.schema';
import { Return, ReturnDocument } from '../returns/schemas/return.schema';

@Injectable()
export class BusinessEarningsCron {
  private readonly logger = new Logger(BusinessEarningsCron.name);

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
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    // Optional so specs that hand-build the cron keep working.
    @Optional()
    @InjectModel(Dispute.name)
    private readonly disputeModel?: Model<DisputeDocument>,
    @Optional()
    @InjectModel(Return.name)
    private readonly returnModel?: Model<ReturnDocument>,
  ) {}

  /** Notify the vendor that a payout landed in their wallet. */
  private async notifyPayout(earning: BusinessEarningDocument) {
    try {
      const business = await this.businessModel
        .findById(earning.business)
        .select('created_by business_name')
        .lean();
      const recipient = (business as any)?.created_by?.id?.toString();
      if (!recipient) return;

      const order = await this.orderModel
        .findById(earning.order)
        .select('reference')
        .lean();

      await this.notificationsService.create({
        recipient,
        recipient_business:
          (earning.business as any)?.toString?.() ?? earning.business,
        category: NotificationCategory.PAYMENT,
        type: NotificationType.PAYOUT_RELEASED,
        title: 'Payout released 💰',
        body: `₦${Number(earning.net_amount).toLocaleString()} has been released to your wallet${(order as any)?.reference ? ` for order #${(order as any).reference}` : ''}.`,
        metadata: {
          order_id: earning.order,
          order_reference: (order as any)?.reference,
          amount: earning.net_amount,
          milestone: earning.milestone,
        },
        action_url: '/wallet',
      });

      // Best-effort: a mail failure must not abort the payout run, which is
      // processing other vendors' earnings in the same pass.
      const to = (business as any)?.created_by?.email;
      if (to) {
        await this.mailService
          .sendPayoutReleasedEmail(
            to,
            (business as any)?.created_by?.name || 'there',
            Number(earning.net_amount),
            (order as any)?.reference,
          )
          .catch((err: any) =>
            this.logger.warn(`Payout email failed: ${err.message}`),
          );
      }
    } catch (err: any) {
      this.logger.warn(`Failed to send payout notification: ${err.message}`);
    }
  }

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

  private async recoverOwed(wallet: WalletDocument) {
    const owed = (wallet as any).owed_balance || 0;
    const take = Math.min(owed, wallet.balance || 0);
    if (take <= 0) return;
    const updated = await this.businessWalletModel.findOneAndUpdate(
      { _id: wallet._id, balance: { $gte: take }, owed_balance: { $gte: take } },
      { $inc: { balance: -take, owed_balance: -take } },
      { new: true },
    );
    if (!updated) return;
    const reference = await generateUniqueQlozetReference(
      this.transactionModel,
      'TRX',
    );
    await this.transactionModel.create({
      wallet: updated._id,
      type: TransactionType.DEBIT,
      amount: take,
      reference,
      status: TransactionStatus.SUCCESS,
      channel: 'debt_recovery',
      payment_method: 'wallet',
      description: 'Recovered money owed from a refunded order',
      metadata: {
        business_id: (updated.business as any)?.toString?.() ?? updated.business,
        debt_recovery: true,
      },
    });
    this.logger.warn(
      `Recovered ₦${take} owed from business ${updated.business} out of this release → balance=${updated.balance} owed=${(updated as any).owed_balance}`,
    );
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async releaseFunds() {
    const now = new Date();
    this.logger.log(`Running releaseFunds cron at ${now.toISOString()}`);

    const pending = await this.businessEarningsModel.find({
      released: false,
      release_date: { $ne: null, $lte: now }, // payment + SETTLEMENT_DAYS (settlement.ts)
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

        if (!(Number(earning.net_amount) > 0)) {
          // A refund or penalty took this earning to nothing: there is no
          // money to release, so close it rather than retrying every run.
          await this.businessEarningsModel.updateOne(
            { _id: earning._id, released: false },
            { $set: { released: true, released_at: new Date(), net_amount: 0 } },
          );
          continue;
        }

        // Atomically CLAIM this earning's release BEFORE crediting. releaseFunds
        // runs on every backend instance every 30 min, so two runs both find the
        // same released:false earning and each credit the wallet — a duplicate
        // payout (the reported triple credit). Only the run whose update flips
        // released false -> true proceeds; the others skip.
        const claim = await this.businessEarningsModel.updateOne(
          { _id: earning._id, released: false },
          { $set: { released: true, released_at: new Date() } },
        );
        if (claim.modifiedCount !== 1) {
          this.logger.warn(
            `Earning ${earning._id} already released by another run — skipping to avoid a duplicate payout.`,
          );
          continue;
        }

        try {
          // Credit the vendor's spendable balance (atomic $inc).
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

          // Ledger credit + notification are best-effort — a failure here must
          // NOT revert the claim (the money is already credited; a revert would
          // re-pay it next run). recordEarningCredit is idempotent by earning id.
          await this.recordEarningCredit(earning, updatedWallet._id).catch((e) =>
            this.logger.warn(`recordEarningCredit failed: ${e.message}`),
          );
          await this.notifyPayout(earning).catch(() => undefined);

          // Money the vendor owes back (a refund their balance could not
          // cover) comes out of this release before they can withdraw it.
          await this.recoverOwed(updatedWallet).catch((e) =>
            this.logger.warn(`recoverOwed failed: ${e.message}`),
          );

          this.logger.log(
            `Released ₦${earning.net_amount} to business ${earning.business} → wallet=${updatedWallet.balance}`,
          );
        } catch (creditError: any) {
          // The credit itself failed → revert the claim so a later run retries
          // (rather than losing the payout). No money moved, so this is safe.
          await this.businessEarningsModel
            .updateOne(
              { _id: earning._id },
              { $set: { released: false, released_at: null } },
            )
            .catch(() => undefined);
          this.logger.error(
            `Release credit failed for earning ${earning._id} (claim reverted): ${creditError.message}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed release for business=${earning.business} order=${earning.order}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Earnings are dated at payment (settlement.ts). Any without a date -
   * recorded before the fixed schedule, or by an older path - are put on the
   * same schedule: SETTLEMENT_DAYS after they were recorded (that is, after
   * the customer paid). One already past that date releases on the next run.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleUndatedEarnings() {
    const undated = await this.businessEarningsModel
      .find({ released: false, release_date: null })
      .select('_id createdAt')
      .lean();
    if (!undated.length) return;

    let scheduled = 0;
    for (const e of undated as any[]) {
      const res = await this.businessEarningsModel.updateOne(
        { _id: e._id, released: false, release_date: null },
        { $set: { release_date: settlementDate(e.createdAt ?? Date.now()) } },
      );
      scheduled += res.modifiedCount;
    }
    this.logger.log(
      `[Settlement] Put ${scheduled} undated earning(s) on the ${SETTLEMENT_DAYS}-day schedule.`,
    );
  }
}
