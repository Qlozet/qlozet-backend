// product.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Fabric, FabricSchema } from './fabric.schema';
import { Accessory, AccessorySchema } from './accessory.schema';
import { Style, StyleSchema } from './style.schema';

// BASE SCHEMAS
@Schema({ _id: false })
export class Color {
  @Prop({ required: true })
  hex: string;
}
export const ColorSchema = SchemaFactory.createForClass(Color);

@Schema({ _id: false })
export class Image {
  @Prop({ required: true })
  publicId: string;
  @Prop({ required: true })
  url: string;
}
export const ImageSchema = SchemaFactory.createForClass(Image);

// BASE PRODUCT SCHEMA

export type ProductDocument = Product & Document;
@Schema({ timestamps: true, discriminatorKey: 'kind', collection: 'products' })
export class Product extends Document {
  @Prop({ required: true, enum: ['clothing', 'fabric', 'accessory'] })
  kind: string;
  @Prop({ required: true })
  title: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  vendor: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Taxonomy' })
  taxonomy?: Types.ObjectId;
  @Prop({ enum: ['active', 'draft', 'archived'], default: 'draft' })
  status: string;
  @Prop({ min: 0 })
  turnaround_days?: number;
  @Prop({ default: false })
  is_customizable?: boolean;
  @Prop({ required: true, min: 0 })
  base_price: number;
  @Prop({ type: [ImageSchema], default: [] })
  images?: Image[];
  @Prop({ type: Object })
  seo?: Record<string, any>;
  @Prop({ type: Object })
  metafields?: Record<string, any>;
  @Prop({ type: FabricSchema, default: null })
  fabrics?: Fabric;
  @Prop({ type: StyleSchema, default: null })
  styles?: Style;
  @Prop({ type: AccessorySchema, default: null })
  accessories?: Accessory;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
