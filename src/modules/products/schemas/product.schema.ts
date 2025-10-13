import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Fabric, FabricSchema } from './fabric.schema';
import { Accessory, AccessorySchema } from './accessory.schema';
import { Clothing, ClothingSchema } from './clothing.schema';

// BASE SCHEMAS
@Schema()
export class Color {
  @Prop({ required: true })
  hex: string;
}
export const ColorSchema = SchemaFactory.createForClass(Color);

// BASE PRODUCT SCHEMA

export type ProductDocument = Product & Document;
@Schema({ timestamps: true, discriminatorKey: 'kind', collection: 'products' })
export class Product extends Document {
  @Prop({ required: true })
  kind: string;
  @Prop({ type: Object })
  seo?: Record<string, any>;
  @Prop({ type: Object })
  metafields?: Record<string, any>;
  @Prop({ required: true, min: 0 })
  base_price: number;
  @Prop({ type: FabricSchema, default: null })
  fabric?: Fabric;

  @Prop({ type: AccessorySchema, default: null })
  accessory?: Accessory;

  @Prop({ type: ClothingSchema, default: null })
  clothing?: Clothing;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  vendor: Types.ObjectId;
  @Prop({ type: Number, default: null })
  discounted_price?: number;

  @Prop({ type: [Types.ObjectId], ref: 'Discount', default: [] })
  applied_discounts?: Types.ObjectId[];
}

export const ProductSchema = SchemaFactory.createForClass(Product);
