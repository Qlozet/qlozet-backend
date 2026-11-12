import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';
import { Fabric, FabricSchema } from './fabric.schema';
import { Accessory, AccessorySchema } from './accessory.schema';
import { Clothing, ClothingSchema } from './clothing.schema';
import {
  defaultStylesPrice,
  keepOneDefaultPerPart,
  usesDefaultStyles,
} from '../style-defaults';
import { newProductCode } from '../product-code';

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

  // The short code in the product's shop address, /p/<name>-<code>
  // (../product-code.ts). Set on create by the pre('validate') hook below; no
  // schema default, because Mongoose would invent one in memory for every old
  // product that has none, and a link built from it would lead nowhere.
  @Prop({ type: String, unique: true, sparse: true })
  code?: string;

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

  // Set when the vendor deletes it: off sale and out of their list, but kept
  // because orders, carts, returns and reservations point at it.
  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Discount', default: null })
  applied_discount: Types.ObjectId;

  @Prop({ type: Number, default: null })
  discounted_price: number;

  @Prop({ type: Number, default: null })
  discount_percentage: number;

  /**
   * Made-to-order clothing: what the default styles add to base_price, so a
   * listing shows the outfit as pictured. Kept by the save hook below.
   */
  @Prop({ type: Number, default: 0 })
  default_styles_price: number;

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

  /** Changes the Qlozet team made to this listing, and why (newest last). */
  @Prop({
    type: [
      {
        at: { type: Date, required: true },
        by: { type: MongooseSchema.Types.ObjectId, ref: 'User', default: null },
        reason: { type: String, required: true },
        changes: { type: [String], default: [] },
      },
    ],
    default: [],
  })
  admin_edits: { at: Date; by: Types.ObjectId | null; reason: string; changes: string[] }[];

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

// Every new product gets its address code, whichever way it is created
// (create, save, insertMany all validate first).
ProductSchema.pre('validate', function () {
  const doc = this as any;
  if (doc.isNew && !doc.code) doc.code = newProductCode();
});

// One marked default per part, and the listing's default-styles price kept in
// step with the styles on every save (create, vendor edit, admin edit).
ProductSchema.pre('save', function () {
  const doc = this as any;
  if (usesDefaultStyles(doc)) {
    keepOneDefaultPerPart(doc.clothing.styles);
    doc.default_styles_price = defaultStylesPrice(doc.clothing.styles);
  } else {
    doc.default_styles_price = 0;
  }
});
