import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Types } from 'mongoose';
import { Color, ColorSchema } from './product.schema';

export type FabricDocument = Fabric & Document;
@Schema({ timestamps: true })
export class Fabric {
  _id?: Types.ObjectId;
  @Prop({ required: true })
  name: string;
  @Prop()
  description?: string;
  @Prop({ required: true })
  product_type: string;
  @Prop({ type: [ColorSchema], default: [] })
  colors?: Color[];
  @Prop()
  pattern?: string;
  @Prop({ required: true, min: 0.1 })
  yard_length: number;
  @Prop({ required: true, min: 10 })
  width: number;
  @Prop({ required: true, min: 0.1 })
  min_cut: number;
  @Prop({ required: true, min: 0 })
  price_per_yard: number;
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
}
export const FabricSchema = SchemaFactory.createForClass(Fabric);
