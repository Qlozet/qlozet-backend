import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderMessageDocument = OrderMessage & Document;

// One message in an order-scoped thread between the customer and the tailor
// (the vendor_to_customer vendor). Bespoke orders only.
@Schema({ timestamps: true })
export class OrderMessage {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  order: Types.ObjectId;

  @Prop({ type: String, required: true })
  order_reference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId; // the tailor

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ type: String, enum: ['customer', 'vendor', 'admin'], required: true })
  sender_role: 'customer' | 'vendor' | 'admin';

  @Prop({ type: String, required: true, trim: true })
  content: string;

  @Prop({ type: Boolean, default: false })
  read_by_customer: boolean;

  @Prop({ type: Boolean, default: false })
  read_by_vendor: boolean;
}

export const OrderMessageSchema = SchemaFactory.createForClass(OrderMessage);
// Fetch a thread newest-work fast + unread counts per order.
OrderMessageSchema.index({ order: 1, createdAt: 1 });
