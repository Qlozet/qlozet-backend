import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum TransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
  REFUND = 'refund',
}

export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

@Schema({ timestamps: true })
export class Transaction extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Business',
    required: true,
  })
  business: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Wallet', default: null })
  wallet?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', default: null })
  order?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  initiator?: Types.ObjectId;

  @Prop({ enum: TransactionType, required: true })
  type: TransactionType;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  @Prop({ type: String, required: true, unique: true })
  reference: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: String, default: 'NGN' })
  currency: string;

  @Prop({ type: String, default: '' })
  payment_method: string; // e.g. 'bank_transfer', 'wallet', 'card'

  @Prop({
    type: String,
    enum: ['checkout', 'wallet_topup', 'refund', 'payout'],
    default: 'checkout',
  })
  channel: string; // Source context

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export type TransactionDocument = Transaction & Document;
export const TransactionSchema = SchemaFactory.createForClass(Transaction);
