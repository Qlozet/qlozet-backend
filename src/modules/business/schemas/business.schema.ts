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

  @Prop({ required: false, unique: true, lowercase: true, trim: true })
  business_email: string;

  @Prop({ required: false })
  business_phone_number?: string;

  @Prop({ required: false })
  business_address: string;

  @Prop()
  address_code?: string;

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
  cover_image_url?: string;

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
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
