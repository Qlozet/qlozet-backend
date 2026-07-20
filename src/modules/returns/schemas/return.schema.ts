import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReturnDocument = Return & Document;

export enum ReturnStatus {
  REQUESTED = 'requested',
  VENDOR_APPROVED = 'vendor_approved',
  VENDOR_REJECTED = 'vendor_rejected',
  RETURN_SHIPPED = 'return_shipped',
  RECEIVED = 'received',
  REFUND_PROCESSED = 'refund_processed',
  CLOSED = 'closed',
}

export enum ReturnReason {
  WRONG_SIZE = 'wrong_size',
  WRONG_ITEM = 'wrong_item',
  DAMAGED = 'damaged',
  NOT_AS_DESCRIBED = 'not_as_described',
  CHANGED_MIND = 'changed_mind',
  OTHER = 'other',
}

@Schema({ timestamps: true })
export class Return extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  order: Types.ObjectId;

  @Prop({ type: String, required: true })
  order_reference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'Product', required: true })
  items: Types.ObjectId[];

  @Prop({ type: String, enum: Object.values(ReturnReason), required: true })
  reason: ReturnReason;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: [String], default: [] })
  evidence_urls: string[];

  @Prop({ type: String, enum: Object.values(ReturnStatus), default: ReturnStatus.REQUESTED })
  status: ReturnStatus;

  @Prop({ type: Number, default: 0 })
  refund_amount: number;

  @Prop({ type: String, default: null })
  return_tracking_number?: string;

  @Prop({ type: String, default: null })
  return_label_url?: string;

  @Prop({ type: String, default: null })
  return_shipment_id?: string;

  @Prop({ type: String, enum: ['customer', 'vendor', 'platform'], default: 'customer' })
  return_shipping_paid_by: string;

  @Prop({ type: Number, default: 0 })
  return_shipping_fee: number;

  @Prop({ type: String, default: null })
  vendor_rejection_reason?: string;

  @Prop({ type: Date, default: null })
  received_at?: Date;

  @Prop({ type: Date, default: null })
  refunded_at?: Date;
}

export const ReturnSchema = SchemaFactory.createForClass(Return);
