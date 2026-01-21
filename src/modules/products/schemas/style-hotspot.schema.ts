import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type StyleHotspotDocument = StyleHotspot & Document;

@Schema({ _id: false })
export class StyleHotspot {
  @Prop({ required: true })
  field_key: string; // e.g., "neckline", "sleeve_style", "skirt"

  @Prop()
  label?: string; // Optional display label override

  @Prop({ required: true, min: 0, max: 1 })
  x: number; // 0..1 (percentage from left)

  @Prop({ required: true, min: 0, max: 1 })
  y: number; // 0..1 (percentage from top)

  @Prop({ enum: ['center', 'top-left'], default: 'center' })
  anchor?: 'center' | 'top-left';

  @Prop({ min: 0 })
  radius?: number; // Optional hit radius in px at 1x

  @Prop({ default: 0 })
  zIndex?: number; // Draw order
}

export const StyleHotspotSchema = SchemaFactory.createForClass(StyleHotspot);
