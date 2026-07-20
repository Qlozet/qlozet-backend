import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
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

export enum ShipmentStatus {
  PENDING = 'pending',
  READY_TO_SHIP = 'ready_to_ship',
  SHIPPED = 'shipped',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}

export enum ShipmentType {
  VENDOR_TO_CUSTOMER = 'vendor_to_customer',
  FABRIC_TRANSFER = 'fabric_transfer',
}

export type OrderDocument = HydratedDocument<Order>;

/** ------------------ Sub-schemas for selections ------------------ */
@Schema({ _id: false })
class VariantSelection {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Variant', required: true })
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
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Fabric', required: true })
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
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Style', required: true })
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
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Accessory', required: true })
  accessory_id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Variant', required: true })
  variant_id: Types.ObjectId;
  @Prop({ type: Number, min: 1 })
  price: number;
  @Prop({ type: Number, min: 1 })
  quantity: number;
  @Prop({ type: Number, min: 1 })
  total_amount: number;
}

@Schema({ _id: false })
class AddonSelection {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  addon_id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  variant_id: Types.ObjectId;

  @Prop({ type: Number, min: 1 })
  quantity: number;

  @Prop({ type: Number, min: 0 })
  price: number;

  @Prop({ type: Number, min: 0 })
  total_amount: number;
}

/** ------------------ Sub-schema for each item ------------------ */
@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null })
  business: Types.ObjectId;

  @Prop({ type: [VariantSelection], default: [] })
  color_variant_selections?: VariantSelection[];

  @Prop({ type: [FabricSelection], default: [] })
  fabric_selections?: FabricSelection[];

  @Prop({ type: [StyleSelection], default: [] })
  style_selections?: StyleSelection[];

  @Prop({ type: [AccessorySelection], default: [] })
  accessory_selections?: AccessorySelection[];

  @Prop({ type: [AddonSelection], default: [] })
  addon_selections?: AddonSelection[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', default: null })
  applied_fabric?: Types.ObjectId;

  @Prop({ type: Number, default: null })
  applied_fabric_yards?: number;

  @Prop({ type: String })
  note?: string;

  @Prop({ type: Number, default: 0 })
  total_price?: number;
}


/** ------------------ Vendor Shipment Sub-Schema ------------------ */
@Schema({ _id: true })
export class VendorShipment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;

  // Rate quote data (saved from checkout-preview)
  @Prop({ type: String })
  request_token?: string;

  @Prop({ type: String })
  service_code?: string;

  @Prop({ type: String })
  courier_id?: string;

  @Prop({ type: String })
  courier_name?: string;

  @Prop({ type: Number, default: 0 })
  shipping_fee: number;

  // Label/shipment data (populated after fulfillment)
  @Prop({ type: String })
  shipment_id?: string;

  @Prop({ type: String })
  tracking_number?: string;

  @Prop({ type: String })
  label_url?: string;

  @Prop({
    type: String,
    enum: Object.values(ShipmentStatus),
    default: ShipmentStatus.PENDING,
  })
  status: ShipmentStatus;

  @Prop({
    type: String,
    enum: Object.values(ShipmentType),
    default: ShipmentType.VENDOR_TO_CUSTOMER,
  })
  shipment_type: ShipmentType;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null })
  destination_business?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', default: null })
  fabric_product?: Types.ObjectId;

  @Prop({ type: Number, default: null })
  fabric_yards?: number;

  @Prop({ type: Boolean, default: false })
  confirmed: boolean;

  @Prop({ type: Date })
  confirmed_at?: Date;

  @Prop({ type: Boolean, default: false })
  rejected: boolean;

  @Prop({ type: Date })
  rejected_at?: Date;

  @Prop({ type: String })
  rejection_reason?: string;

  @Prop({ type: Date })
  rate_fetched_at?: Date;

  @Prop({ type: Date })
  shipped_at?: Date;

  @Prop({ type: Date })
  delivered_at?: Date;

  // Late fulfillment penalty tracking
  @Prop({ type: Date, default: null })
  fulfillment_deadline?: Date;

  @Prop({ type: Boolean, default: false })
  late_penalty_applied: boolean;

  @Prop({ type: Number, default: 0 })
  late_penalty_amount: number;

  @Prop({ type: Number, default: 0 })
  late_penalty_days: number;
}

export const VendorShipmentSchema = SchemaFactory.createForClass(VendorShipment);

/** ------------------ Main Order Schema ------------------ */
@Schema({ timestamps: true })
export class Order {
  @Prop()
  reference: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
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

  @Prop({ type: String, enum: ['standard', 'bespoke'], default: 'standard' })
  type?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BespokeDesign', default: null })
  bespoke_design?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BespokeQuote', default: null })
  bespoke_quote?: Types.ObjectId;

  /** @deprecated Use shipments[].tracking_number instead */
  @Prop({ type: String })
  tracking_number?: string;

  /** @deprecated Use shipments[].courier_name instead */
  @Prop({ type: String })
  courier_name?: string;

  @Prop({ type: [VendorShipmentSchema], default: [] })
  shipments: VendorShipment[];
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

  @Prop({
    type: {
      body_type: { type: String },
      confidence: { type: String },
      measurements: { type: Object },
      unit: { type: String },
      fit_preferences: { type: [String], default: [] },
    },
    default: null,
  })
  customer_body_profile?: {
    body_type: string;
    confidence: string;
    measurements: Record<string, number>;
    unit: string;
    fit_preferences: string[];
  };

  @Prop({ type: Boolean, default: false })
  customer_satisfied?: boolean;

  @Prop({ type: Date, default: null })
  customer_satisfied_at?: Date;
}
export const OrderSchema = SchemaFactory.createForClass(Order);
