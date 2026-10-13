import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type WalletDocument = Wallet & Document;

@Schema({ timestamps: true })
export class Wallet {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', unique: true, sparse: true })
  business: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', unique: true, sparse: true })
  customer: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  balance: number;

  @Prop({ type: Number, default: 0 })
  pending_balance: number;

  // Money the vendor owes the platform back: a refund (return, cancellation
  // after an upfront release, late penalty) that the spendable balance could
  // not cover because it had already been withdrawn. Netted off the next
  // release and blocks withdrawals until cleared. Before this the shortfall
  // was floored to zero and simply lost.
  @Prop({ type: Number, default: 0 })
  owed_balance: number;

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
