import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Address, AddressSchema } from '../../ums/schemas/address.schema';

export enum OrderStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  PROCESSING = 'processing',
  IN_TRANSIT = 'in_transit',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
}
export const ALLOWED_STATUSES = [OrderStatus.PROCESSING, OrderStatus.COMPLETED];

export type OrderDocument = Order & Document;

/** ------------------ Sub-schemas for selections ------------------ */
@Schema({ _id: false })
class VariantSelection {
  @Prop({ type: Types.ObjectId, ref: 'Variant', required: true })
  variant_id: Types.ObjectId;

  @Prop({ type: String })
  size?: string;
  @Prop({ type: Number, min: 1 })
  price: number;
  @Prop({ type: Number, min: 1 })
  quantity: number;
  @Prop({ type: Number, min: 1 })
  total_amount: number;
}

@Schema({ _id: false })
class FabricSelection {
  @Prop({ type: Types.ObjectId, ref: 'Fabric', required: true })
  fabric_id: Types.ObjectId;

  @Prop({ type: Number, min: 0.1 })
  yardage: number;

  @Prop({ type: Number, min: 1 })
  price: number;

  @Prop({ type: Number, min: 1 })
  quantity: number;

  @Prop({ type: Number, min: 1 })
  total_amount: number;
}

@Schema()
class StyleSelection {
  @Prop({ type: Types.ObjectId, ref: 'Style', required: true })
  style_id: Types.ObjectId;
  @Prop({ type: Number, min: 1 })
  price: number;
  @Prop({ type: Number, min: 1 })
  quantity: number;
  @Prop({ type: Number, min: 1 })
  total_amount: number;
}

@Schema({ _id: false })
class AccessorySelection {
  @Prop({ type: Types.ObjectId, ref: 'Accessory', required: true })
  accessory_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Variant', required: true })
  variant_id: Types.ObjectId;
  @Prop({ type: Number, min: 1 })
  price: number;
  @Prop({ type: Number, min: 1 })
  quantity: number;
  @Prop({ type: Number, min: 1 })
  total_amount: number;
}

/** ------------------ Sub-schema for each item ------------------ */
@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Business', default: null })
  business: Types.ObjectId;

  @Prop({ type: [VariantSelection], default: [] })
  color_variant_selections?: VariantSelection[];

  @Prop({ type: [FabricSelection], default: [] })
  fabric_selections?: FabricSelection[];

  @Prop({ type: [Types.ObjectId], default: [] })
  style_selections?: StyleSelection[];

  @Prop({ type: [AccessorySelection], default: [] })
  accessory_selections?: AccessorySelection[];

  @Prop({ type: String })
  note?: string;
}

/** ------------------ Main Order Schema ------------------ */
@Schema({ timestamps: true })
export class Order {
  @Prop()
  reference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;

  @Prop({ type: [OrderItem], required: true })
  items: OrderItem[];

  @Prop({ type: AddressSchema })
  address: Address;

  @Prop({ type: Number, required: true })
  subtotal: number;

  @Prop({ type: Number, default: 0 })
  shipping_fee: number;

  @Prop({ type: Number, required: true })
  total: number;

  @Prop({
    type: String,
    enum: Object.values(OrderStatus),
    default: 'pending',
  })
  status: OrderStatus;

  @Prop({ type: String })
  tracking_number?: string;

  @Prop({ type: String })
  courier_name?: string;
  @Prop({ type: Number, default: 0 })
  vendor_earnings?: number; // After commission removed

  @Prop({ type: Number, default: 0 })
  platform_commission?: number;

  @Prop({ type: Date, default: null })
  payout_eligible_at?: Date; // completedAt + payout_delay_days

  @Prop({
    type: String,
    enum: ['pending', 'eligible', 'paid'],
    default: 'pending',
  })
  payout_status?: 'pending' | 'eligible' | 'paid';
}

export const OrderSchema = SchemaFactory.createForClass(Order);
