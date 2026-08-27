import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';
import { Fabric, FabricSchema } from './fabric.schema';
import { Accessory, AccessorySchema } from './accessory.schema';
import { Clothing, ClothingSchema } from './clothing.schema';

export type ProductDocument = Product & Document;
import { ProductStatus } from '../enums/product-status.enum';
import { ProductModerationStatus } from '../enums/product-moderation.enum';

export enum ProductKind {
  CLOTHING = 'clothing',
  FABRIC = 'fabric',
  ACCESSORY = 'accessory',
}



// Main Product schema
@Schema({ timestamps: true, discriminatorKey: 'kind', collection: 'products' })
export class Product extends Document {
  @Prop({ required: true, enum: ProductKind })
  kind: string;

  @Prop({ type: Object })
  seo?: Record<string, any>;

  @Prop({ type: Object })
  metafields?: Record<string, any>;

  @Prop({ required: true, min: 0 })
  base_price: number;

  @Prop({ type: String, enum: ProductStatus, default: ProductStatus.DRAFT })
  status: ProductStatus;

  @Prop({ type: FabricSchema, default: null })
  fabric?: Fabric;

  @Prop({ type: AccessorySchema, default: null })
  accessory?: Accessory;

  @Prop({ type: ClothingSchema, default: null })
  clothing?: Clothing;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;
  @Prop({ type: Date, default: null })
  scheduled_activation_date?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Discount', default: null })
  applied_discount: Types.ObjectId;

  @Prop({ type: Number, default: null })
  discounted_price: number;

  @Prop({ type: Number, default: null })
  discount_percentage: number;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Collection' }], default: [] })
  collections: Types.ObjectId[];
  @Prop({
    type: [
      {
        user: { type: MongooseSchema.Types.ObjectId, ref: 'User', required: true },
        value: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String },
      },
    ],
    default: [],
  })
  ratings: {
    user: Types.ObjectId;
    value: number;
    comment?: string;
  }[];

  @Prop({ type: Number, default: 0 })
  average_rating: number;

  @Prop({
    type: [
      {
        name: { type: String, required: true },
        slug: { type: String, required: true },
        type: { type: String, enum: ['system', 'custom'], required: true },
      },
    ],
    default: [],
  })
  tags: { name: string; slug: string; type: 'system' | 'custom' }[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SizeGuide', default: null })
  size_guide: Types.ObjectId;

  /**
   * Platform-side moderation, set from the admin catalogue. Independent of
   * `status`, which stays the vendor's own publish switch — a rejected product
   * is hidden from customers no matter what the vendor sets `status` to.
   * Undefined on legacy documents, which read as PENDING.
   */
  @Prop({
    type: {
      status: {
        type: String,
        enum: ProductModerationStatus,
        default: ProductModerationStatus.PENDING,
      },
      reason: { type: String, default: null },
      moderated_at: { type: Date, default: null },
      moderated_by: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
    default: () => ({ status: ProductModerationStatus.PENDING }),
    _id: false,
  })
  moderation?: {
    status: ProductModerationStatus;
    reason?: string | null;
    moderated_at?: Date | null;
    moderated_by?: Types.ObjectId | null;
  };
}

export const ProductSchema = SchemaFactory.createForClass(Product);
