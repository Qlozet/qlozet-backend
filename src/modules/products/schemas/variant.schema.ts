import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Color, ColorSchema } from './product.schema';
import { ProductImage, ProductImageSchema } from './product-image.schema';

export type VariantDocument = Variant & Document;

@Schema({ timestamps: true })
export class Variant {
  @Prop({ type: [ColorSchema], default: [] })
  colors?: Color[];
  @Prop()
  size?: string;
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
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
