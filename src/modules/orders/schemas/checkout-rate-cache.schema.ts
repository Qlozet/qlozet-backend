import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CheckoutRateCacheDocument = CheckoutRateCache & Document;

@Schema({ _id: false })
export class CachedCourierRate {
  @Prop({ type: String, required: true })
  courier_id: string;

  @Prop({ type: String, required: true })
  service_code: string;

  @Prop({ type: String })
  courier_name: string;

  @Prop({ type: Number, required: true })
  rate_amount: number;
}

@Schema({ timestamps: true })
export class CheckoutRateCache {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  request_token: string;

  @Prop({ type: String, required: true })
  business_id: string;

  @Prop({ type: [CachedCourierRate], required: true })
  rates: CachedCourierRate[];

  @Prop({ type: Date, default: Date.now, expires: 1800 }) // 30-minute TTL
  createdAt: Date;
}

export const CheckoutRateCacheSchema =
  SchemaFactory.createForClass(CheckoutRateCache);
