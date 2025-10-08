import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class Image {
  @Prop() url: string;
  @Prop() publicId: string;
}
export const ImageSchema = SchemaFactory.createForClass(Image);

@Schema({ _id: false })
export class Size {
  @Prop({ required: true }) size: string;
  @Prop({ default: 0 }) quantity: number;
  @Prop({ default: 0 }) price?: number;
  @Prop() sku?: string;
}
export const SizeSchema = SchemaFactory.createForClass(Size);

@Schema({ _id: false })
export class Variant {
  @Prop() color?: string;
  @Prop({ type: ImageSchema }) fabric?: Image;
  @Prop({ type: ImageSchema }) variantImage?: Image;
  @Prop() yardPerOrder?: number;
  @Prop({ type: [SizeSchema], default: [] }) sizes: Size[];
}
export const VariantSchema = SchemaFactory.createForClass(Variant);

@Schema({ _id: true, timestamps: true })
export class Product extends Document {
  @Prop({ required: true, unique: true }) name: string;
  @Prop() description?: string;
  @Prop({ enum: ['customized', 'non-customized'], required: true })
  productMode: 'customized' | 'non-customized';
  @Prop() material?: string;
  @Prop() productType?: string;
  @Prop() category?: string;
  @Prop() tag?: string;
  @Prop({ enum: ['active', 'inactive'], default: 'active' }) status: string;
  @Prop({ enum: ['men', 'women', 'unisex'], required: true }) audience: string;
  @Prop({ type: [VariantSchema], default: [] }) variants: Variant[];
  @Prop({ type: MongooseSchema.Types.Mixed, default: [] })
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  customizations: Record<string, any>[];
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  vendorId: Types.ObjectId;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
