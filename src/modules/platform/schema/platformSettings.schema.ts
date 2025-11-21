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

  @Prop({ type: Number, default: 7 })
  payout_delay_days: number;

  @Prop({ type: Number, default: 0 })
  tailored_order_upfront: number; // percentage (e.g. 50 = 50%)

  @Prop({ type: Number, default: 10 })
  platform_commission_percent: number;

  @Prop({ type: Number, default: 0 })
  payment_handling_fee_percent: number;

  @Prop({ type: Number, default: 0 })
  payment_handling_fee_flat: number;

  @Prop({ type: Number, default: 0 })
  tax_percent: number;
}

export type PlatformSettingsDocument = PlatformSettings & Document;
export const PlatformSettingsSchema =
  SchemaFactory.createForClass(PlatformSettings);
