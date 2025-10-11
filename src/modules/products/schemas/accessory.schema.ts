import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Product } from './product.schema';
import { Variant, VariantSchema } from './variant.schema';

// ACCESSORY SCHEMA
export type AccessoryDocument = Accessory & Document;
@Schema({ timestamps: true })
export class Accessory {
  @Prop({ required: true })
  name: string;
  @Prop()
  description?: string;
  @Prop({ required: true })
  product_type: string;
  @Prop({ required: true })
  category: string;
  @Prop()
  subcategory?: string;
  @Prop([String])
  tags?: string[];
  @Prop({ type: [VariantSchema], required: true, default: [] })
  variants: Variant[];
}
export const AccessorySchema = SchemaFactory.createForClass(Accessory);
