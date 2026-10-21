import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Types } from 'mongoose';
import { Variant, VariantSchema } from './variant.schema';
import {
  Color,
  ColorSchema,
  ColorVariant,
  ColorVariantSchema,
} from './color.schema';

export type FabricDocument = Fabric & Document;
@Schema({ timestamps: true })
export class Fabric {
  _id?: Types.ObjectId;
  @Prop({ required: true })
  name: string;
  @Prop()
  description?: string;
  @Prop({ required: true })
  product_type: string;
  @Prop()
  material?: string; // e.g. Cotton, Silk, Ankara — shown on the fabric card
  @Prop({ type: [ColorSchema], default: [] })
  colors?: Color[];
  @Prop()
  pattern?: string;
  @Prop({ required: true, min: 0.1 })
  yard_length: number;
  @Prop({ required: true, min: 10 })
  width: number;
  @Prop({ required: true, min: 0.1 })
  min_cut: number;
  @Prop({ required: true, min: 0 })
  price_per_yard: number;

  // How the fabric is sold (see products/fabric-pieces.ts): 'yard' (default),
  // 'piece' (whole pieces only) or 'both'. A piece is piece_yards long and
  // costs piece_price. Stock stays in yards (yard_length).
  @Prop({ type: String, enum: ['yard', 'piece', 'both'], default: 'yard' })
  sold_by?: 'yard' | 'piece' | 'both';

  @Prop({ type: Number, default: null, min: 0.5 })
  piece_yards?: number | null;

  @Prop({ type: Number, default: null, min: 1 })
  piece_price?: number | null;
  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
  @Prop({ type: [VariantSchema], default: [] })
  variants?: Variant[];
}
export const FabricSchema = SchemaFactory.createForClass(Fabric);
