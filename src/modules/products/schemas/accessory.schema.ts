import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Variant, VariantSchema } from './variant.schema';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Types } from 'mongoose';

// ACCESSORY SCHEMA
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
  base_price: number;
  @Prop({ type: VariantSchema, required: true, default: null })
  variant: Variant;
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
  @Prop({ default: true })
  in_stock: boolean;

  @Prop({ min: 0, default: 0 })
  stock: number;
}
export const AccessorySchema = SchemaFactory.createForClass(Accessory);
