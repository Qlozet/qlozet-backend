import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum BusinessStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}
export type BusinessDocument = Business & Document;

@Schema({ timestamps: true })
export class Business extends Document {
  @Prop({ required: true, trim: true })
  business_name: string;

  @Prop({ required: false, unique: true, sparse: true, lowercase: true, trim: true })
  business_email: string;

  @Prop({ required: false })
  business_phone_number?: string;

  @Prop({ required: false })
  business_address: string;

  @Prop({ type: Number, default: null })
  address_code?: number; // Shipbubble validated address code

  @Prop({ type: String, default: null })
  validated_address?: string; // Formatted address from Shipbubble

  @Prop()
  address_line_2?: string;

  @Prop()
  time_zone?: string;

  @Prop()
  country?: string;

  @Prop()
  state?: string;

  @Prop()
  city?: string;

  @Prop()
  zip_code?: string;

  @Prop({ default: false })
  address_completed: boolean;

  @Prop()
  bvn?: string;

  @Prop()
  nin?: string;

  @Prop({ required: false })
  display_picture_url?: string;

  @Prop()
  website?: string;

  @Prop({ type: [String], default: [] })
  cac_document_url?: string[];

  @Prop({ required: false })
  business_logo_url?: string;

  @Prop({ required: false })
  business_logo_svg_url?: string;

  @Prop({ required: false })
  cover_image_url?: string;

  @Prop({ required: false })
  theme_color?: string; // Vendor storefront accent color (hex, e.g. '#8D7F72')

  @Prop({
    type: {
      instagram: { type: String, default: null },
      twitter: { type: String, default: null },
      pinterest: { type: String, default: null },
      youtube: { type: String, default: null },
      tiktok: { type: String, default: null },
    },
    default: {},
  })
  social_links?: {
    instagram?: string;
    twitter?: string;
    pinterest?: string;
    youtube?: string;
    tiktok?: string;
  };

  @Prop({ type: Boolean, default: true })
  accepts_external_fabric: boolean; // Whether this vendor accepts fabric from other vendors for bespoke orders

  @Prop({ default: false })
  email_verified: boolean;

  @Prop({ default: null })
  verification_token?: string;

  @Prop({ default: false })
  verification_token_used?: boolean;

  @Prop({ default: null })
  verification_token_expiration?: Date;

  @Prop({
    type: [
      {
        user: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
        comment: String,
        rating: { type: Number, min: 1, max: 5 },
        created_at: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  reviews?: Array<{
    user: Types.ObjectId;
    comment: string;
    rating: number;
    created_at: Date;
  }>;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  successful_deliveries?: number;

  @Prop({ default: 0 })
  returned_deliveries?: number;

  @Prop({ default: 0 })
  total_items_sold?: number;

  @Prop({ default: 0 })
  success_rate?: number;

  @Prop({ default: false })
  is_featured?: boolean;

  @Prop({ default: 0 })
  earnings?: number;

  @Prop()
  year_founded?: string;

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  followers?: Types.ObjectId[];

  @Prop({ default: true })
  is_active?: boolean;

  @Prop({ default: false })
  two_factor_auth?: boolean;

  @Prop({ default: null })
  two_factor_code?: string;

  @Prop({ default: null })
  two_factor_code_expiration?: Date;

  @Prop({
    type: {
      general: {
        enable_order_confirmation: { type: Boolean, default: true },
        enable_order_notifications: { type: Boolean, default: true },
      },
      notifications: {
        order_status: { type: Boolean, default: true },
        returns_and_refunds: { type: Boolean, default: true },
        order_tracking: { type: Boolean, default: true },
      },
      customization: {
        daily_order_limit: { type: Number, default: 0 },
      },
      worker_settings: {
        max_workers: { type: Number, default: 10 },
        allow_worker_invites: { type: Boolean, default: true },
        require_approval: { type: Boolean, default: true },
      },
    },
    default: {},
  })
  order_settings?: {
    general: {
      enable_order_confirmation: boolean;
      enable_order_notifications: boolean;
    };
    notifications: {
      order_status: boolean;
      returns_and_refunds: boolean;
      order_tracking: boolean;
    };
    customization: { daily_order_limit: number };
    worker_settings: {
      max_workers: number;
      allow_worker_invites: boolean;
      require_approval: boolean;
    };
  };
  @Prop({
    type: String,
    enum: ['pending', 'in-review', 'approved', 'verified', 'rejected'],
    default: 'pending',
  })
  status: string;
  @Prop({
    type: {
      id: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
      name: String,
      email: String,
    },
    default: null,
  })
  created_by?: {
    id?: Types.ObjectId;
    name?: string;
    email?: string;
  };
  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    ref: 'TeamMember',
    default: [],
  })
  team_members?: Types.ObjectId[];
  @Prop({ type: Number, default: 0 })
  pending_payout_balance: number; // Money waiting for payout

  @Prop({ type: Number, default: 0 })
  lifetime_earned?: number;

  @Prop({ type: Number, default: 0 })
  lifetime_paid_out?: number;

  @Prop({ type: Date, default: null })
  last_payout_date?: Date;

  @Prop({ type: Date, default: null })
  next_payout_date?: Date;

  @Prop({ type: [String], default: [] })
  payout_history?: string[]; // store payout ref IDs for audit

  @Prop({ default: null })
  transfer_recipient_code?: number;
  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);

// Fix: Drop the old non-sparse unique index on business_email so Mongoose
// can recreate it with sparse: true. Without this, MongoDB rejects multiple
// businesses with null business_email (E11000 duplicate key on null).
BusinessSchema.pre('init', async function () {
  // This runs once on model init — noop after first run
});

// Programmatic index fix — run once on model compilation
BusinessSchema.statics.fixIndexes = async function () {
  try {
    await this.collection.dropIndex('business_email_1');
    console.log('✅ Dropped old business_email_1 index');
  } catch (e: any) {
    if (e.codeName !== 'IndexNotFound') {
      console.log('ℹ️ business_email_1 index:', e.message);
    }
  }
  await this.ensureIndexes();
  console.log('✅ Recreated business indexes (with sparse)');
};
