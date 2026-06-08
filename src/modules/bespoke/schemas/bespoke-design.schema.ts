import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum BespokeDesignStatus {
  DRAFT = 'draft',
  REQUESTING_QUOTES = 'requesting_quotes',
  QUOTED = 'quoted',
  ACCEPTED = 'accepted',
  IN_PRODUCTION = 'in_production',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export type BespokeDesignDocument = BespokeDesign & Document;

@Schema({ timestamps: true })
export class BespokeDesign {
  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true, enum: ['men', 'women'] })
  gender: string;

  // ─── Images (Cloudinary URLs from existing generate-outfit endpoint) ───
  @Prop({ type: [String], default: [] })
  design_images: string[];

  @Prop({ type: [String], default: [] })
  reference_images: string[];

  // ─── Fabric (from platform catalog) ───
  @Prop({ type: Types.ObjectId, ref: 'Product', default: null })
  fabric: Types.ObjectId;

  // ─── Optional Details ───
  @Prop({ type: String, default: null })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  measurement: Types.ObjectId;

  // ─── State ───
  @Prop({
    type: String,
    enum: Object.values(BespokeDesignStatus),
    default: BespokeDesignStatus.DRAFT,
  })
  status: BespokeDesignStatus;

  @Prop({ type: Types.ObjectId, ref: 'BespokeQuote', default: null })
  accepted_quote: Types.ObjectId;
}

export const BespokeDesignSchema =
  SchemaFactory.createForClass(BespokeDesign);
