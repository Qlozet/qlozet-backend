import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DisputeDocument = Dispute & Document;

export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED_REFUND = 'resolved_refund',
  RESOLVED_PARTIAL_REFUND = 'resolved_partial',
  RESOLVED_RELEASED = 'resolved_released',
  CLOSED = 'closed',
}

export enum DisputeReason {
  WRONG_ITEM = 'wrong_item',
  DAMAGED = 'damaged',
  NOT_AS_DESCRIBED = 'not_as_described',
  POOR_QUALITY = 'poor_quality',
  MISSING_ITEMS = 'missing_items',
  MEASUREMENT_ISSUE = 'measurement_issue', // vendor-raised: customer measurements look off
  OTHER = 'other',
}

@Schema({ timestamps: true })
export class Dispute extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  order: Types.ObjectId;

  @Prop({ type: String, required: true })
  order_reference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(DisputeReason), required: true })
  reason: DisputeReason;

  @Prop({ type: String, required: true })
  description: string;

  @Prop({ type: [String], default: [] })
  evidence_urls: string[];

  // Who raised it — disputes are usually customer-filed; a measurement flag is
  // vendor-filed. `body_part` is the measurement the vendor flagged (if any).
  @Prop({ type: String, enum: ['customer', 'vendor'], default: 'customer' })
  initiated_by?: 'customer' | 'vendor';

  @Prop({ type: String, default: null })
  body_part?: string;

  @Prop({ type: String, enum: Object.values(DisputeStatus), default: DisputeStatus.OPEN })
  status: DisputeStatus;

  @Prop({ type: String, default: null })
  vendor_response?: string;

  @Prop({ type: [String], default: [] })
  vendor_evidence_urls?: string[];

  @Prop({ type: String, default: null })
  admin_notes?: string;

  @Prop({ type: Number, default: null })
  refund_amount?: number;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolved_by?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  resolved_at?: Date;
}

export const DisputeSchema = SchemaFactory.createForClass(Dispute);
