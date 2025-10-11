import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TaxonomyDocument = Taxonomy & Document;

@Schema({ timestamps: true, collection: 'taxonomies' })
export class Taxonomy {
  @Prop({ required: true })
  product_type: string;

  @Prop({ required: true })
  category: string;

  @Prop()
  sub_category?: string;

  @Prop([String])
  tags?: string[];

  @Prop()
  audience?: string;
}

export const TaxonomySchema = SchemaFactory.createForClass(Taxonomy);
