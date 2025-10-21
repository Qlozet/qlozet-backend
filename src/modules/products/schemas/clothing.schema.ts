import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Variant, VariantSchema } from './variant.schema';
import { Fabric, FabricSchema } from './fabric.schema';
import { Style, StyleSchema } from './style.schema';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { Accessory, AccessorySchema } from './accessory.schema';

export type ClothingDocument = Clothing & Document;

@Schema({ timestamps: true })
export class Clothing {
  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true, min: 0 })
  turnaround_days: number;

  @Prop({ default: false })
  is_customizable?: boolean;

  @Prop({ type: TaxonomySchema, required: true })
  taxonomy: Taxonomy;

  @Prop({ enum: ['active', 'draft', 'archived'], default: 'draft' })
  status: 'active' | 'draft' | 'archived';

  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];

  @Prop({ type: [StyleSchema], default: [] })
  styles?: Style;

  @Prop({ type: [AccessorySchema], default: [] })
  accessory?: Accessory;

  @Prop({ type: [VariantSchema], default: [] })
  color_variants?: Variant[];

  @Prop({ type: [FabricSchema], default: [] })
  fabric_variants?: Fabric[];
}

export const ClothingSchema = SchemaFactory.createForClass(Clothing);
