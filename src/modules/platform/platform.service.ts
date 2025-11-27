import { Injectable } from '@nestjs/common';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from './schema/platformSettings.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { CurrencyService } from '../currency/currency.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class PlatformService {
  constructor(
    @InjectModel(PlatformSettings.name)
    private readonly model: Model<PlatformSettingsDocument>,
    private readonly currencyService: CurrencyService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Africa/Lagos' }) // 3 AM daily
  async autoRefreshTokenPrice() {
    try {
      await this.updateNgnTokenPrice();
      console.log('🔄 NGN token price refreshed automatically.');
    } catch (err) {
      console.error('❌ Failed to refresh token price:', err.message);
    }
  }
  private defaultSettings(): Partial<PlatformSettings> {
    return {
      payout_cycle: 'weekly',
      minimum_payout: 2000,
      payout_delay_days: 7,
      tailored_order_upfront_percent: 0,
      platform_commission_percent: 10,
      payment_handling_fee_flat: 0,
      payment_handling_fee_percent: 0,
      tax_percent: 0.75,
      token_price: {
        usd: { currency: 'USD', amount: 0.01 },
        ngn: { currency: 'NGN', amount: 0, last_updated: new Date() },
      },
    };
  }

  async create(): Promise<PlatformSettingsDocument> {
    return this.model.create(this.defaultSettings());
  }

  async getSettings(): Promise<PlatformSettingsDocument> {
    const settings = await this.model.findOne();
    return settings ?? this.create();
  }

  async update(
    dto: Partial<PlatformSettings>,
  ): Promise<PlatformSettingsDocument> {
    return this.model.findOneAndUpdate({}, dto, {
      new: true,
      upsert: true,
    });
  }

  async compute(totalAmount: number) {
    const settings = await this.getSettings();

    const commission =
      (settings.platform_commission_percent / 100) * totalAmount;

    const handlingPercent =
      (settings.payment_handling_fee_percent / 100) * totalAmount;

    const handlingFlat = settings.payment_handling_fee_flat;

    const tax = (settings.tax_percent / 100) * totalAmount;

    const totalFees = handlingPercent + handlingFlat + tax;

    const vendorEarnings = totalAmount - commission - totalFees;

    return {
      vendorEarnings,
      commission,
      totalFees,
      tax,
      payoutEligibleAt: new Date(
        Date.now() + settings.payout_delay_days * 86400000,
      ),
    };
  }

  async updateNgnTokenPrice() {
    const settings = await this.getSettings();
    const usdPrice = settings.token_price.usd.amount;

    // Convert to NGN using your currency service
    const newNgnPrice = await this.currencyService.convertUsdTo(
      usdPrice,
      'NGN',
    );

    settings.token_price.ngn.amount = newNgnPrice;
    settings.token_price.ngn.last_updated = new Date();

    await settings.save();
    return settings.token_price;
  }
}
