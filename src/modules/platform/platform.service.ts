import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from './schema/platformSettings.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class PlatformService {
  constructor(
    @InjectModel(PlatformSettings.name)
    private readonly model: Model<PlatformSettingsDocument>,
  ) {}

  async create(): Promise<PlatformSettingsDocument> {
    return await this.model.create({
      payout_cycle: 'weekly',
      minimum_payout: 2000,
      payout_delay_days: 7,
      tailored_order_upfront: 0,
      platform_commission_percent: 10,
      payment_handling_fee_flat: 0,
      payment_handling_fee_percent: 0,
      tax_percent: 0.75, // newly added tax field
    });
  }
  // Get platform payout settings
  async getSettings(): Promise<PlatformSettingsDocument> {
    const settings = await this.model.findOne();
    if (!settings) {
      return this.create();
      // throw new NotFoundException('Platform settings not found');
    }
    return settings;
  }

  // Update platform settings
  async update(
    dto: Partial<PlatformSettings>,
  ): Promise<PlatformSettingsDocument> {
    return await this.model.findOneAndUpdate({}, dto, {
      new: true,
      upsert: true,
    });
  }

  // Compute vendor earnings, fees, and payout date
  async compute(totalAmount: number) {
    const settings = await this.getSettings();

    const commission =
      (settings.platform_commission_percent / 100) * totalAmount;
    const handlingPercentFee =
      (settings.payment_handling_fee_percent / 100) * totalAmount;
    const handlingFlatFee = settings.payment_handling_fee_flat;
    const tax = (settings.tax_percent / 100) * totalAmount;

    const totalGatewayFee = handlingPercentFee + handlingFlatFee + tax;
    const vendorEarnings = totalAmount - commission - totalGatewayFee;

    return {
      vendorEarnings,
      commission,
      totalGatewayFee,
      tax,
      payoutEligibleAt: new Date(
        Date.now() + settings.payout_delay_days * 86400000,
      ),
    };
  }
}
