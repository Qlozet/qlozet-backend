import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Fabric, FabricSchema } from './fabric.schema';
import { Style, StyleSchema } from './style.schema';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { Accessory, AccessorySchema } from './accessory.schema';
import { ColorVariant, ColorVariantSchema } from './color.schema';
import { AddOn, AddOnSchema } from './addon.schema';

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

  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];

  @Prop({ type: [StyleSchema], default: [] })
  styles?: Style[];

  @Prop({ type: [AccessorySchema], default: [] })
  accessories?: Accessory[];

  @Prop({ type: [ColorVariantSchema], default: [] })
  color_variants?: ColorVariant[];

  @Prop({ type: [FabricSchema], default: [] })
  fabrics?: Fabric[];

  // Garment-level fabric requirement (bill of materials): how many yards this
  // garment consumes per size. Fabric-agnostic, so it drives pricing for both
  // embedded and external (cross-vendor) fabric, plus inventory depletion and
  // reservation claims.
  @Prop({
    type: [{ size: { type: String }, yards: { type: Number, min: 0 } }],
    default: [],
  })
  yardage_per_size?: { size: string; yards: number }[];

  @Prop({ type: Boolean, default: null })
  accepts_external_fabric?: boolean | null; // null = inherit from vendor, true/false = override

  @Prop({ type: [AddOnSchema], default: [] })
  addons?: AddOn[];
}

export const ClothingSchema = SchemaFactory.createForClass(Clothing);
