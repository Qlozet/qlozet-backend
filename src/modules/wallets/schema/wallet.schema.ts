import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WalletDocument = Wallet & Document;

@Schema({ timestamps: true })
export class Wallet {
  @Prop({ type: Types.ObjectId, ref: 'Business', unique: true, sparse: true })
  business: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', unique: true, sparse: true })
  customer: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  balance: number;

  @Prop({ type: Number, default: 0 })
  pending_balance: number;

  @Prop({ required: true, default: 'NGN' })
  currency: string;

  @Prop({ required: false })
  last_transaction_at?: Date;

  @Prop({ default: 'active', enum: ['active', 'suspended', 'closed'] })
  status: 'active' | 'suspended' | 'closed';

  @Prop({ required: false, trim: true })
  account_number?: string;

  @Prop({ required: false, trim: true })
  account_name?: string;

  @Prop({ required: false, trim: true })
  bank_name?: string;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
