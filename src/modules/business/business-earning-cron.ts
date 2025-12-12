import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Wallet, WalletDocument } from '../wallets/schema/wallet.schema';
import { Model } from 'mongoose';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from './schemas/business-earnings.schema';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class BusinessEarningsCron {
  private readonly logger = new Logger(BusinessEarningsCron.name);

  constructor(
    @InjectModel(BusinessEarning.name)
    private readonly businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(Wallet.name)
    private readonly businessWalletModel: Model<WalletDocument>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES) // every hour
  async releaseFunds() {
    const now = new Date();
    this.logger.log(`Running releaseFunds cron at ${now.toISOString()}`);

    const pending = await this.businessEarningsModel.find({
      released: false,
      release_date: { $lte: now },
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
}
