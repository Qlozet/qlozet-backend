import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CollectionDocument = Collection & Document;

export enum CollectionScope {
  VENDOR = 'vendor',
  PLATFORM = 'platform',
}

@Schema({ timestamps: true })
export class Collection {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ default: 'all', enum: ['all', 'any'] })
  condition_match: 'all' | 'any';

  @Prop([
    {
      field: { type: String, required: true },
      operator: { type: String, required: true },
      value: { type: String, required: true },
    },
  ])
  conditions: { field: string; operator: string; value: string }[];

  @Prop({ default: true })
  is_active: boolean;

  @Prop({
    type: Types.ObjectId,
    ref: 'Business',
    required: false,
    index: true,
    default: null,
  })
  business: Types.ObjectId;

  @Prop({
    default: CollectionScope.VENDOR,
    enum: CollectionScope,
    index: true,
  })
  scope: CollectionScope;

  @Prop({ required: false, trim: true })
  slug?: string;

  @Prop({ required: false })
  cover_image?: string;

  // ── Explore scoping (platform collections) ──
  // Which explore contexts a platform collection appears in. Empty = shows on
  // every explore page; otherwise only where the page's kind / product_type
  // matches. Admin-controlled merchandising, not inferred.
  @Prop({ type: [String], default: [] })
  kinds: string[]; // e.g. ['clothing', 'accessory', 'fabric']

  @Prop({ type: [String], default: [] })
  product_types: string[]; // e.g. ['agbada', 'dress']

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Product' }],
    default: [],
  })
  manual_includes: Types.ObjectId[];

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Product' }],
    default: [],
  })
  manual_excludes: Types.ObjectId[];

  @Prop({ default: 0 })
  sort_order: number;
}

export const CollectionSchema = SchemaFactory.createForClass(Collection);
