import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Variant, VariantSchema } from './variant.schema';

@Schema({ _id: false })
export class Color {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  hex?: string;
}

export const ColorSchema = SchemaFactory.createForClass(Color);

@Schema({ _id: true })
export class ColorVariant {
  _id: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  hex: string;

  // Photos of the garment in THIS colour, each carrying its own hotspots.
  // The path was missing, so Mongoose silently dropped what the vendor sent
  // and the shop had to fall back to the first size variant's copy — which
  // meant a colour with no sizes lost its images entirely, and every size
  // redundantly stored the same array.
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];

  @Prop({ type: [VariantSchema], default: [] })
  variants: Variant[];
}

export const ColorVariantSchema = SchemaFactory.createForClass(ColorVariant);
