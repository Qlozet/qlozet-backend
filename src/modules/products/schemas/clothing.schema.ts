import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Variant, VariantSchema } from './variant.schema';
import { Fabric, FabricSchema } from './fabric.schema';
import { Style, StyleSchema } from './style.schema';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { Accessory, AccessorySchema } from './accessory.schema';
import { Color, ColorSchema } from './product.schema';

export enum ClothingType {
  CUSTOMIZE = 'customize',
  NON_CUSTOMIZE = 'non_customize',
}
export type ClothingDocument = Clothing & Document;

@Schema({ timestamps: true })
export class Clothing {
  @Prop({ required: true, enum: ClothingType })
  type: ClothingType;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true, min: 0 })
  turnaround_days: number;

  @Prop({ type: TaxonomySchema, required: true })
  taxonomy: Taxonomy;

  @Prop({ enum: ['active', 'draft', 'archived'], default: 'draft' })
  status: 'active' | 'draft' | 'archived';

  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];

  @Prop({ type: [StyleSchema], default: [] })
  styles?: Style[];

  @Prop({ type: [AccessorySchema], default: [] })
  accessories?: Accessory[];

  @Prop({ type: [ColorSchema], default: [] })
  color_variants?: Color[];

  @Prop({ type: [FabricSchema], default: [] })
  fabrics?: Fabric[];
}

export const ClothingSchema = SchemaFactory.createForClass(Clothing);
