import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type MeasurementCorrectionDocument = MeasurementCorrection & Document;

/**
 * One measurement we had, replaced by a better one (measurement-corrections.ts).
 * Append-only: the record of how far off our numbers were.
 */
@Schema({ timestamps: { createdAt: 'created_at', updatedAt: false }, collection: 'measurement_corrections' })
export class MeasurementCorrection {
  @Prop({ type: String, enum: ['tailor_question', 'profile_edit'], required: true, index: true })
  source: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, default: null })
  set_name: string | null;

  @Prop({ type: String, required: true, index: true })
  part: string;

  @Prop({ type: Number, required: true })
  before_cm: number;

  @Prop({ type: Number, required: true })
  after_cm: number;

  @Prop({ type: Number, required: true })
  delta_cm: number;

  @Prop({ type: String, default: null })
  before_tier: string | null;

  @Prop({ type: String, default: null })
  before_method: string | null;

  @Prop({ type: String, default: null })
  set_method: string | null;

  @Prop({ type: Boolean, default: false })
  estimated: boolean;

  @Prop({ type: Boolean, default: false })
  outlier: boolean;

  /** The estimate's inputs (height, weight, gender, body shape), for refitting. */
  @Prop({ type: Object, default: null })
  inputs: Record<string, any> | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', default: null })
  order: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null })
  business: Types.ObjectId | null;
}

export const MeasurementCorrectionSchema = SchemaFactory.createForClass(MeasurementCorrection);
MeasurementCorrectionSchema.index({ part: 1, estimated: 1, outlier: 1 });
