import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { StyleHotspot, StyleHotspotSchema } from './style-hotspot.schema';

export type ProductImageDocument = ProductImage & Document;

@Schema({ _id: false })
export class ProductImage {
  @Prop({ required: true })
  public_id: string;

  @Prop({ required: true })
  url: string;

  @Prop()
  width?: number;

  @Prop()
  height?: number;

  @Prop({ type: [StyleHotspotSchema], default: [] })
  hotspots?: StyleHotspot[];
}

export const ProductImageSchema = SchemaFactory.createForClass(ProductImage);
