import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TaxonomyDocument = Taxonomy & Document;

@Schema({ timestamps: true, _id: true })
export class Taxonomy {
  @Prop({ required: true })
  product_type: string;

  @Prop({ type: [String], required: true })
  categories: string[];

  @Prop({ type: [String], required: true })
  attributes: string[];

  @Prop({ type: String, required: true })
  audience: string;
}

export const TaxonomySchema = SchemaFactory.createForClass(Taxonomy);
