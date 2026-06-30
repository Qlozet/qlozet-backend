import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type PlatformStyleDocument = PlatformStyle & Document;

export enum StyleCategory {
  NECKLINE = 'neckline',
  SLEEVE = 'sleeve',
  COLLAR = 'collar',
  SKIRT = 'skirt',
  TROUSER = 'trouser',
  FULL_BODY = 'full_body',
  BODICE = 'bodice',
  HEMLINE = 'hemline',
  BACK = 'back',
}

export enum StyleType {
  TOP = 'top',
  BOTTOM = 'bottom',
  FULL_BODY = 'full_body',
  ACCESSORY = 'accessory',
}

export enum StyleGender {
  MALE = 'male',
  FEMALE = 'female',
  UNISEX = 'unisex',
}

@Schema({ timestamps: true })
export class PlatformStyle {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  style_code: string;

  @Prop({ required: true, enum: StyleCategory })
  category: StyleCategory;

  @Prop({ required: true, enum: StyleType })
  type: StyleType;

  @Prop({ enum: StyleGender, default: StyleGender.UNISEX })
  gender: StyleGender;

  @Prop()
  description?: string;

  @Prop()
  image_url?: string;

  @Prop({ type: [String], default: [] })
  aliases: string[];

  @Prop({ type: [String], default: [] })
  attributes: string[];

  @Prop({ min: 0 })
  price_suggestion?: number;

  @Prop({ default: true })
  is_active: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null })
  business?: Types.ObjectId;
}

export const PlatformStyleSchema =
  SchemaFactory.createForClass(PlatformStyle);

// Index for efficient filtering
PlatformStyleSchema.index({ category: 1, type: 1, is_active: 1 });
PlatformStyleSchema.index({ style_code: 1 }, { unique: true });
