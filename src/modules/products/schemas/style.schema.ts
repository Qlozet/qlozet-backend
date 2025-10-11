import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Image, ImageSchema } from './product.schema';
import { Variant, VariantSchema } from './variant.schema';

export type StyleDocument = Style & Document;

/**
 * STYLE SCHEMA
 * Used for customizable clothing templates
 */
@Schema({ timestamps: true, collection: 'styles' })
export class Style {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  styleCode: string;

  @Prop({ required: true, enum: ['men', 'women', 'unisex', 'kids'] })
  audience: string;

  @Prop([String])
  categories: string[];

  @Prop([String])
  tags: string[];

  @Prop({ type: [ImageSchema], default: [] })
  images?: Image[];

  @Prop({ min: 0 })
  price?: number;

  @Prop()
  minWidthCm?: number;

  @Prop()
  notes?: string;

  @Prop({ type: Object })
  fields?: Record<
    string,
    {
      label: string;
      options: {
        name: string;
        price_effect?: number;
        yardage_effect?: number;
      }[];
    }
  >;
  @Prop({ type: [VariantSchema], required: true, default: [] })
  variants: Variant[];
}

export const StyleSchema = SchemaFactory.createForClass(Style);
