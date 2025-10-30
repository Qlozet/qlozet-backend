// src/schemas/style.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';

export type StyleDocument = Style & Document;

/**
 * Sub-schema for each selectable option in a style field
 */
@Schema()
export class StyleFieldOption {
  @Prop({ required: true })
  name: string;

  @Prop({ type: Number })
  price_effect?: number;

  @Prop({ type: Number })
  yardage_effect?: number;
}

export const StyleFieldOptionSchema =
  SchemaFactory.createForClass(StyleFieldOption);

/**
 * Sub-schema for each field in a style
 */
@Schema()
export class StyleField {
  @Prop({ required: true })
  label: string;

  @Prop({ type: [StyleFieldOptionSchema], required: true, default: null })
  options: StyleFieldOption;
}

export const StyleFieldSchema = SchemaFactory.createForClass(StyleField);

/**
 * Main Style schema
 */
@Schema({ timestamps: true })
export class Style {
  _id?: Types.ObjectId;
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  style_code: string;

  @Prop({ type: [String], required: true })
  categories: string[];

  @Prop({ type: [String], required: true })
  attributes: string[];

  @Prop({ type: [ProductImageSchema], default: [] })
  images: ProductImage[];

  @Prop({ min: 0 })
  price: number;

  @Prop()
  min_width_cm?: number;

  @Prop()
  notes?: string;

  @Prop({ type: String, required: true })
  type: string;
}

export const StyleSchema = SchemaFactory.createForClass(Style);
