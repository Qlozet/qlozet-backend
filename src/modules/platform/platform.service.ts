import { Injectable } from '@nestjs/common';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from './schema/platformSettings.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { CurrencyService } from '../currency/currency.service';
import { Cron } from '@nestjs/schedule';
import { UpdatePlatformSettingsDto } from './dto/update-settings.dto';

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
      payout_delay_days: 3,
      auto_release_days: 10,
      // Custom/tailored orders release 65% up front (on vendor confirm) and 35%
      // on delivery + payout_delay_days. (§16 milestone payout.)
      tailored_order_upfront_percent: 65,
      platform_commission_percent: 10,
      platform_commission_type: 'percent',
      platform_commission_flat: 0,
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
    dto: UpdatePlatformSettingsDto,
  ): Promise<PlatformSettingsDocument> {
    return this.model.findOneAndUpdate({}, dto as Partial<PlatformSettings>, {
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
    const rawNgnPrice = await this.currencyService.convertUsdTo(
      usdPrice,
      'NGN',
    );

    // Store to kobo precision (2 dp). The raw FX rate yields many decimals, so
    // `quantity × price` produces a fractional-kobo total that Paystack rejects
    // ("amount must be an integer") and that makes the displayed price disagree
    // with the charged one. Rounding the per-token price to whole kobo keeps
    // every purchase total a whole number of kobo.
    const newNgnPrice = Math.round(rawNgnPrice * 100) / 100;

    settings.token_price.ngn.amount = newNgnPrice;
    settings.token_price.ngn.last_updated = new Date();

    await settings.save();
    return settings.token_price;
  }
}
