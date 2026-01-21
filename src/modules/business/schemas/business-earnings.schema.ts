import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BusinessEarningDocument = BusinessEarning & Document;

@Schema({ timestamps: true })
export class BusinessEarning extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  order: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount: number; // gross amount for this business

  @Prop({ type: Number, default: 0 })
  commission: number; // your platform cut

  @Prop({ type: Number, required: true })
  net_amount: number; // amount to release to vendor

  @Prop({ default: false })
  released: boolean;

  @Prop({ type: Date, required: true })
  release_date: Date; // after 7 days

  @Prop({ default: null })
  released_at: Date;
}

export const BusinessEarningSchema =
  SchemaFactory.createForClass(BusinessEarning);
