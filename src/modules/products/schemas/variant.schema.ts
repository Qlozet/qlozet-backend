import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Color, ColorSchema, Image, ImageSchema } from './product.schema';

export type VariantDocument = Variant & Document;

@Schema({ _id: false })
export class Variant {
  @Prop({ type: [ColorSchema], default: [] })
  colors?: Color[];
  @Prop()
  size?: string;
  @Prop({ type: [ImageSchema], default: [] })
  images?: Image[];
  @Prop({ min: 0 })
  stock: number;
  @Prop({ min: 0 })
  price: number;
  @Prop()
  sku?: string;
  @Prop({ type: Object })
  measurement_range?: Record<string, any>;
  @Prop({ type: Object })
  attributes?: Record<string, any>;
}
export const VariantSchema = SchemaFactory.createForClass(Variant);
