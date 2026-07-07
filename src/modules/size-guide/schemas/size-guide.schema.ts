import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type SizeGuideDocument = SizeGuide & Document;

/* ────────────────────── Sub-schemas ────────────────────── */

@Schema({ _id: false })
export class SizeMeasurementRange {
  @Prop({ required: true })
  body_part: string;

  @Prop({ required: true, type: Number })
  min: number;

  @Prop({ required: true, type: Number })
  max: number;
}
export const SizeMeasurementRangeSchema =
  SchemaFactory.createForClass(SizeMeasurementRange);

@Schema({ _id: false })
export class SizeEntry {
  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ type: Number, default: 0 })
  sort_order: number;

  @Prop({ type: [SizeMeasurementRangeSchema], default: [] })
  measurements: SizeMeasurementRange[];
}
export const SizeEntrySchema = SchemaFactory.createForClass(SizeEntry);

@Schema({ _id: false })
export class FitAllowance {
  @Prop({ required: true })
  body_part: string;

  @Prop({ required: true, type: Number })
  value: number;
}
export const FitAllowanceSchema = SchemaFactory.createForClass(FitAllowance);

@Schema({ _id: false })
export class FitType {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ type: [FitAllowanceSchema], default: [] })
  allowances: FitAllowance[];
}
export const FitTypeSchema = SchemaFactory.createForClass(FitType);

/* ────────────────────── Main schema ────────────────────── */

@Schema({ timestamps: true })
export class SizeGuide {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Business',
    required: true,
    index: true,
  })
  business: Types.ObjectId;

  /* ── Measurement config ── */

  @Prop({ required: true, enum: ['cm', 'inch'], default: 'cm' })
  unit: 'cm' | 'inch';

  @Prop({ type: [String], default: [] })
  body_parts: string[];

  /* ── Size chart ── */

  @Prop({ type: [SizeEntrySchema], default: [] })
  sizes: SizeEntry[];

  /* ── Fit types ── */

  @Prop({ type: [FitTypeSchema], default: [] })
  fit_types: FitType[];

  /* ── Condition-based product matching (same as Collections / Discounts) ── */

  @Prop({ default: 'all', enum: ['all', 'any'] })
  condition_match: 'all' | 'any';

  @Prop([
    {
      field: { type: String, required: true },
      operator: { type: String, required: true },
      value: { type: String, required: true },
    },
  ])
  conditions: { field: string; operator: string; value: string }[];

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Product' }],
    default: [],
  })
  manual_includes: Types.ObjectId[];

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Product' }],
    default: [],
  })
  manual_excludes: Types.ObjectId[];

  @Prop({ default: true })
  is_active: boolean;
}

export const SizeGuideSchema = SchemaFactory.createForClass(SizeGuide);
