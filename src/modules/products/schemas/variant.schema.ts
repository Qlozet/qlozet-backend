import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';

export type VariantDocument = Variant & Document;

@Schema({ timestamps: true })
export class Variant {
  _id?: Types.ObjectId;
  @Prop()
  size: string;
  @Prop({ min: 0 })
  stock: number;
  @Prop({ min: 0 })
  price: number;

  @Prop({ min: 0 })
  yard_per_order: number;

  @Prop()
  sku?: string;
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
}
export const VariantSchema = SchemaFactory.createForClass(Variant);
