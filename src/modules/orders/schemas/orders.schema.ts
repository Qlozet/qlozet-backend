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
  // Colour name + hex snapshot (from the product's colour variant) so order and
  // item views can show the chosen colour without re-resolving the product.
  @Prop({ type: String })
  color?: string;
  @Prop({ type: String })
  hex?: string;
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

  // Optional: the variant only pins stock. Accessories chosen without one are
  // priced at their base price; requiring it here threw a Mongoose
  // ValidationError (surfaced as a 500) when saving such an order.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Variant', required: false })
  variant_id?: Types.ObjectId;
  // Display snapshots (accessory name + chosen variant colour).
  @Prop({ type: String })
  name?: string;
  @Prop({ type: String })
  color?: string;
  @Prop({ type: String })
  hex?: string;
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
// _id is enabled (Mongoose default) so a single item can be targeted for
// per-item vendor rejection. Orders placed before this change have no item ids
// and fall back to whole-shipment rejection.
@Schema()
export class OrderItem {
  // Optional: bespoke order items have no catalog product (the design/quote hold
  // the details). Standard order items always set this.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', default: null })
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

  // Frozen itemized pricing snapshot at order time (§27). `final` == total_price.
  @Prop({ type: Object })
  pricing?: {
    base: number;
    styles_total: number;
    fabric_total: number;
    variant_total: number;
    accessories_total: number;
    addons_total: number;
    // Customer-supplied external fabric cost (fabric vendor's revenue). Recorded
    // here for the books and added to the order total, but NOT in `final` /
    // total_price (which drives the tailor's earnings).
    external_fabric?: number;
    before_discount: number;
    discount: number;
    final: number;
  };

  // Per-item vendor rejection (e.g. out of stock on just this line). Refunds
  // and restocks only this item; the rest of the order proceeds.
  @Prop({ type: Boolean, default: false })
  rejected?: boolean;

  @Prop({ type: Date, default: null })
  rejected_at?: Date;

  @Prop({ type: String })
  rejection_reason?: string;

  // Order-time measurement snapshot for THIS garment. A single order can
  // carry custom items for different bodies (e.g. asoebi/family orders) —
  // each item freezes the set it must be sewn to.
  @Prop({ type: Object, default: null })
  body_profile?: {
    body_type?: string | null;
    confidence?: string | null;
    measurements: Record<string, number>;
    unit: string;
    fit_preferences?: string[];
    set_name?: string | null;
  } | null;
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

  // Courier ETA for this shipment (captured from the rate at creation). Used by
  // the fabric card's ETA + the SLA warning (fabric ETA vs quote completion days).
  @Prop({ type: Number, default: null })
  eta_days?: number;

  @Prop({ type: Date, default: null })
  expected_delivery_at?: Date;

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

  // Set atomically the moment this shipment's auto-reject refund is issued, so a
  // second concurrent cron instance (or an overlapping run) cannot double-refund
  // the customer / double-reverse the vendor's earnings.
  @Prop({ type: Boolean, default: false })
  refunded: boolean;

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

  // Bespoke production checklist for this vendor's shipment. Step keys are the
  // fixed 4 (fabric_cut/sewing/finishing/quality_check); labels/descriptions are
  // derived in code so we don't persist presentation. `ready_to_ship_at` records
  // the "mark ready to ship" action (distinct from fulfill, which makes the label).
  @Prop({
    type: [
      {
        key: { type: String },
        completed: { type: Boolean, default: false },
        completed_at: { type: Date, default: null },
      },
    ],
    default: [],
  })
  production_steps?: {
    key: string;
    completed: boolean;
    completed_at?: Date;
  }[];

  @Prop({ type: Date, default: null })
  ready_to_ship_at?: Date;
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

  // 'reservation' = an organizer's fabric-reservation FEE order (platform
  // revenue, nothing to fulfil); 'reservation_claim' = a guest buying yards
  // from a reservation (the fabric vendor fulfils it like a fabric sale).
  @Prop({
    type: String,
    enum: ['standard', 'bespoke', 'reservation', 'reservation_claim'],
    default: 'standard',
  })
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

  // Atomically-claimed guard so BusinessEarnings are recorded exactly once per
  // order — recordBusinessEarnings is called from several places (payment
  // webhook, order creation, bespoke accept, backfill) that can race.
  @Prop({ type: Boolean, default: false })
  earnings_recorded?: boolean;

  @Prop({ type: Boolean, default: false })
  inventory_deducted?: boolean; // idempotency: guards double stock deduction on webhook retries

  @Prop({ type: Date, default: null })
  payout_eligible_at?: Date; // completedAt + payout_delay_days

  @Prop({
    type: String,
    enum: ['pending', 'eligible', 'paid'],
    default: 'pending',
  })
  payout_status?: 'pending' | 'eligible' | 'paid'; // vendor PAYOUT (not customer payment)

  // Customer-facing payment/refund state (denormalised from Transactions so the
  // order list can render Paid/Refunded without joining the transactions coll).
  @Prop({ type: String, enum: ['unpaid', 'paid'], default: 'unpaid' })
  payment_status?: 'unpaid' | 'paid';

  @Prop({
    type: String,
    enum: ['none', 'partial', 'refunded'],
    default: 'none',
  })
  refund_status?: 'none' | 'partial' | 'refunded';

  // ── Multi-currency legs (plan Phase 1) ──
  // Presentment = what the customer saw/paid; settlement = what the vendor
  // earns (their business.default_currency); fx_rate is LOCKED at checkout
  // (mid-market + fx_markup_percent) and reused for refunds. Existing pre-field
  // orders read as all-NGN via the defaults. Amounts on the order itself remain
  // major units today (subtotal/total); *_minor fields land with the
  // minor-units migration.
  @Prop({ type: String, default: 'NGN' })
  presentment_currency?: string;

  @Prop({ type: String, default: 'NGN' })
  settlement_currency?: string;

  @Prop({ type: Number, default: 1 })
  fx_rate?: number; // presentment → settlement, incl. markup

  @Prop({ type: Number, default: 0 })
  fx_markup_percent?: number;

  @Prop({ type: Number, default: null })
  group_amount_usd?: number | null; // consolidation view (minor units)

  @Prop({ type: String, enum: ['paystack', 'stripe'], default: 'paystack' })
  processor?: 'paystack' | 'stripe';

  @Prop({ type: String, enum: ['ng', 'us'], default: 'ng' })
  entity?: 'ng' | 'us'; // which settlement entity the money landed in

  @Prop({
    type: {
      body_type: { type: String },
      confidence: { type: String },
      measurements: { type: Object },
      unit: { type: String },
      fit_preferences: { type: [String], default: [] },
      set_name: { type: String, default: null },
    },
    default: null,
  })
  customer_body_profile?: {
    body_type: string;
    confidence: string;
    measurements: Record<string, number>;
    unit: string;
    fit_preferences: string[];
    /** Which measurement set was chosen at order time (e.g. "For Tolu"). */
    set_name?: string | null;
  };

  @Prop({ type: Boolean, default: false })
  customer_satisfied?: boolean;

  @Prop({ type: Date, default: null })
  customer_satisfied_at?: Date;
}
export const OrderSchema = SchemaFactory.createForClass(Order);
