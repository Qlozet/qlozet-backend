import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Variant, VariantSchema } from './variant.schema';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { ProductImage, ProductImageSchema } from './product-image.schema';

export type StyleDocument = Style & Document;

/**
 * STYLE SCHEMA
 * Used for customizable clothing templates
 */
@Schema({ timestamps: true, collection: 'styles' })
export class Style {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  style_code: string;

  @Prop({ type: TaxonomySchema, required: true })
  taxonomy: Taxonomy;

  @Prop({ type: [ProductImageSchema], default: [] })
  images: ProductImage[];

  @Prop({ min: 0 })
  price: number;

  @Prop()
  min_width_cm?: number;

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
}

export const StyleSchema = SchemaFactory.createForClass(Style);
