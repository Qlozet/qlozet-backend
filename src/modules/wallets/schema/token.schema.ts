// src/token/token.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export enum TokenTransactionType {
  SPEND = 'spend',
  EARN = 'earn',
  PURCHASE = 'purchase',
  EXPIRE = 'expire',
}

@Schema({ timestamps: true })
export class TokenTransaction extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Token', required: true })
  token: Types.ObjectId;

  @Prop({ enum: TokenTransactionType, required: true })
  type: TokenTransactionType;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String })
  feature?: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;
}

export type TokenTransactionDocument = TokenTransaction & Document;
export const TokenTransactionSchema =
  SchemaFactory.createForClass(TokenTransaction);

@Schema({ timestamps: true })
export class Token {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  customer: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Business', default: null, index: true })
  business: Types.ObjectId | null;

  @Prop({ required: true, default: 0 })
  tokens: number;

  @Prop({ required: true, default: 0 })
  lifetimeEarned: number;

  @Prop({ required: true, default: 0 })
  lifetimeSpent: number;

  @Prop()
  expiresAt?: Date;

  @Prop({
    type: [
      {
        type: { type: String, enum: TokenTransactionType, required: true },
        amount: { type: Number, required: true },
        feature: { type: String },
        timestamp: { type: Date, default: Date.now },
        metadata: { type: MongooseSchema.Types.Mixed },
      },
    ],
    default: [],
  })
  transactionHistory: {
    type: TokenTransactionType;
    amount: number;
    feature?: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }[];
}

export type TokenDocument = Token & Document;
export const TokenSchema = SchemaFactory.createForClass(Token);
