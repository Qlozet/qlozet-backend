import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ProductKind } from '../../products/schemas/product.schema';

export type SystemCategoryDocument = SystemCategory & Document;

@Schema({ timestamps: true, collection: 'system_categories' })
export class SystemCategory {
  @Prop({ required: true, enum: ProductKind })
  kind: string;

  @Prop({ required: true, trim: true })
  product_type: string;

  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ type: [String], default: [] })
  attributes: string[];

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sort_order: number;

  @Prop({ default: true })
  is_active: boolean;
}

export const SystemCategorySchema =
  SchemaFactory.createForClass(SystemCategory);

// Ensure only one "Dress" per "clothing"
SystemCategorySchema.index({ kind: 1, product_type: 1 }, { unique: true });
