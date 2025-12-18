import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
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

  @Prop({ type: [VariantSchema], default: [] })
  variants: Variant[];
}

export const ColorVariantSchema = SchemaFactory.createForClass(ColorVariant);
