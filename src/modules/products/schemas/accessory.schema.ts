import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { ProductImage, ProductImageSchema } from './product-image.schema';

/** ---------------- COLOR SCHEMA ---------------- */
@Schema()
export class Color {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  hex?: string;
}

export const ColorSchema = SchemaFactory.createForClass(Color);

/** ---------------- ACCESSORY VARIANT ---------------- */
@Schema()
export class AccessoryVariant {
  _id?: Types.ObjectId;
  @Prop({ type: () => ColorSchema, required: true })
  color: Color;

  @Prop({ type: [String], required: true })
  size: string[];

  @Prop({ min: 0, required: true })
  stock: number;
}

export const AccessoryVariantSchema =
  SchemaFactory.createForClass(AccessoryVariant);

/** ---------------- ACCESSORY ---------------- */
export type AccessoryDocument = Accessory & Document;

@Schema({ timestamps: true, _id: true })
export class Accessory {
  _id?: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: TaxonomySchema, required: true })
  taxonomy: Taxonomy;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop({ type: [AccessoryVariantSchema], required: true, default: [] })
  variants: AccessoryVariant[];

  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];

  @Prop({ default: true })
  in_stock: boolean;

  @Prop({ min: 0, default: 0 })
  stock: number;
}

export const AccessorySchema = SchemaFactory.createForClass(Accessory);
