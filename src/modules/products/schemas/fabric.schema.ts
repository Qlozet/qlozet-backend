import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Product } from './product.schema';
import { Variant, VariantSchema } from './variant.schema';

export type FabricDocument = Fabric & Document;
@Schema({ _id: false, timestamps: true })
export class Fabric {
  @Prop({ required: true })
  name: string;
  @Prop()
  description?: string;
  @Prop({ required: true })
  productType: string;
  @Prop({ type: [String], default: [] })
  colors?: string[];
  @Prop()
  pattern?: string;
  @Prop({ required: true, min: 0.1 })
  yardLength: number;
  @Prop({ required: true, min: 10 })
  width: number;
  @Prop({ required: true, min: 0.1 })
  minCut: number;
  @Prop({ required: true, min: 0 })
  pricePerYard: number;
  @Prop({ type: [VariantSchema], required: true, default: [] })
  variants: Variant[];
}
export const FabricSchema = SchemaFactory.createForClass(Fabric);
