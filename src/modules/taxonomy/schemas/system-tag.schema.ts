import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ProductKind } from '../../products/schemas/product.schema';

export type SystemTagDocument = SystemTag & Document;

export enum TagAssignableBy {
  ADMIN_ONLY = 'admin_only',
  VENDOR = 'vendor',
}

@Schema({ timestamps: true, collection: 'system_tags' })
export class SystemTag {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ enum: ProductKind, required: false, default: null })
  kind?: string;

  @Prop({ required: true, enum: TagAssignableBy })
  assignable_by: string;

  @Prop({ default: 0 })
  sort_order: number;

  @Prop({ default: true })
  is_active: boolean;
}

export const SystemTagSchema = SchemaFactory.createForClass(SystemTag);
