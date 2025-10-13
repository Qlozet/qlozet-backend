import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Variant, VariantSchema } from './variant.schema';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { ProductImage, ProductImageSchema } from './product-image.schema';

// ACCESSORY SCHEMA
export type AccessoryDocument = Accessory & Document;
@Schema({ timestamps: true })
export class Accessory {
  @Prop({ required: true })
  name: string;
  @Prop()
  description?: string;
  @Prop({ type: TaxonomySchema, required: true })
  taxonomy: Taxonomy;
  @Prop({ required: true, min: 0 })
  base_price: number;
  @Prop({ type: [VariantSchema], required: true, default: [] })
  variants: Variant[];
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
}
export const AccessorySchema = SchemaFactory.createForClass(Accessory);
