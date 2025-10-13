import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CollectionDocument = Collection & Document;

@Schema({ timestamps: true })
export class Collection {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ default: 'all', enum: ['all', 'any'] })
  condition_match: 'all' | 'any';

  @Prop([
    {
      field: { type: String, required: true },
      operator: { type: String, required: true },
      value: { type: String, required: true },
    },
  ])
  conditions: { field: string; operator: string; value: string }[];

  @Prop({ default: true })
  is_active: boolean;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  vendor: Types.ObjectId;
}

export const CollectionSchema = SchemaFactory.createForClass(Collection);
