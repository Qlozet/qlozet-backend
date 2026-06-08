import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum BespokeQuoteStatus {
  PENDING = 'pending',
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  REVISION_REQUESTED = 'revision_requested',
}

export type BespokeQuoteDocument = BespokeQuote & Document;

// ─── Sub-schemas ───
@Schema({ _id: false })
class QuoteLineItem {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true, min: 0 })
  amount: number;
}

@Schema({ _id: false })
class RevisionEntry {
  @Prop({ required: true, enum: ['customer', 'vendor'] })
  requested_by: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Date, default: Date.now })
  created_at: Date;
}

// ─── Main Schema ───
@Schema({ timestamps: true })
export class BespokeQuote {
  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: Types.ObjectId, ref: 'BespokeDesign', required: true })
  design: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  vendor: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BespokeQuoteStatus),
    default: BespokeQuoteStatus.PENDING,
  })
  status: BespokeQuoteStatus;

  // ─── Line Items ───
  @Prop({
    type: [{ label: String, amount: Number }],
    default: [],
  })
  line_items: QuoteLineItem[];

  @Prop({ type: Number, default: 0 })
  total: number;

  // ─── Vendor Details ───
  @Prop({ type: Number, default: null })
  required_fabric_yards: number;

  @Prop({ type: Number, default: null })
  estimated_completion_days: number;

  @Prop({ type: String, default: null })
  vendor_notes: string;

  // ─── Revision History ───
  @Prop({
    type: [
      {
        requested_by: { type: String, enum: ['customer', 'vendor'] },
        message: String,
        created_at: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  revision_history: RevisionEntry[];

  // ─── Timestamps ───
  @Prop({ type: Date, default: null })
  submitted_at: Date;

  @Prop({ type: Date, default: null })
  accepted_at: Date;

  // ─── Expiry (auto-set to 7 days from creation) ───
  @Prop({ type: Date, required: true })
  expires_at: Date;
}

export const BespokeQuoteSchema =
  SchemaFactory.createForClass(BespokeQuote);
