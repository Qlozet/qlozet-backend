import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AddOnVariantDocument = AddOnVariant & Document;

@Schema({ _id: true })
export class AddOnVariant {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop()
  color_hex?: string; // Used when display_type = 'colour'

  @Prop()
  image_url?: string; // Used when display_type = 'picture'
}

export const AddOnVariantSchema = SchemaFactory.createForClass(AddOnVariant);

export type AddOnDocument = AddOn & Document;

@Schema({ _id: true })
export class AddOn {
  @Prop({ required: true })
  name: string; // e.g., "Buttons", "Thread"

  @Prop({ required: true, enum: ['colour', 'picture'], default: 'colour' })
  display_type: 'colour' | 'picture';

  @Prop({ type: [AddOnVariantSchema], default: [] })
  variants: AddOnVariant[];
}

export const AddOnSchema = SchemaFactory.createForClass(AddOn);
