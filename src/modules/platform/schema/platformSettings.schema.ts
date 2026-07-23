import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PlatformSettings extends Document {
  @Prop({
    type: String,
    enum: ['weekly', 'bi-weekly', 'monthly'],
    default: 'weekly',
  })
  payout_cycle: string;

  @Prop({ type: Number, default: 2000 })
  minimum_payout: number;

  @Prop({ type: Number, default: 3 })
  payout_delay_days: number;

  @Prop({ type: Number, default: 5 })
  late_penalty_percent_per_day: number;

  @Prop({ type: Number, default: 25 })
  late_penalty_max_percent: number;

  @Prop({ type: Number, default: 24 })
  auto_reject_hours: number;

  @Prop({ type: Number, default: 7 })
  return_window_days: number;

  @Prop({ type: Number, default: 10 })
  platform_commission_percent: number;

  // Commission can be a percentage of the item price, or a flat ₦ amount.
  @Prop({ type: String, enum: ['percent', 'fixed'], default: 'percent' })
  platform_commission_type: 'percent' | 'fixed';

  @Prop({ type: Number, default: 0 })
  platform_commission_flat: number;

  @Prop({ type: Number, default: 0 })
  payment_handling_fee_percent: number;

  @Prop({ type: Number, default: 0 })
  payment_handling_fee_flat: number;

  @Prop({ type: Number, default: 0 })
  tax_percent: number;
  @Prop({ type: Number, default: 25 })
  image_measurement_token_price: number;

  @Prop({ type: Number, default: 45 })
  video_measurement_token_price: number;

  @Prop({ type: Number, default: 45 })
  outfit_generation_token_price: number;

  @Prop({ type: Number, default: 45 })
  edit_garment_token_price: number;

  @Prop({ type: Number, default: 45 })
  run_prediction_token_price: number;

  @Prop({ type: Number, default: 0 })
  ai_ask_token_price: number;

  @Prop({ type: Number, default: 10 })
  analyze_reference_token_price: number;

  @Prop({ type: Boolean, default: false })
  ai_ask_requires_auth: boolean;

  @Prop({ type: Number, default: 0 })
  tailored_order_upfront_percent: number;

  @Prop({ type: Number, default: 10 })
  reservation_fee_percent: number;
  @Prop({
    type: {
      usd: {
        amount: { type: Number, default: 0.01 },
        currency: { type: String, default: 'USD' },
      },
      ngn: {
        amount: { type: Number, default: 15 },
        currency: { type: String, default: 'NGN' },
        last_updated: { type: Date, default: new Date() },
      },
    },
    default: {
      usd: { amount: 0.01, currency: 'USD' },
      ngn: { amount: 15, currency: 'NGN', last_updated: new Date() },
    },
  })
  token_price: {
    usd: { amount: number; currency: string };
    ngn: { amount: number; currency: string; last_updated: Date };
  };
}

export type PlatformSettingsDocument = PlatformSettings & Document;
export const PlatformSettingsSchema =
  SchemaFactory.createForClass(PlatformSettings);
