import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FxRateDocument = FxRate & Document;

// Last-good FX rate per pair, persisted so a restart (or a rate-API outage)
// doesn't leave the charge path blind. Written on every successful fetch; read
// as the fallback for charge-path quotes (which otherwise FAIL CLOSED — the
// hardcoded in-code rates are never used for real money).
@Schema({ timestamps: true })
export class FxRate {
  @Prop({ type: String, required: true })
  base: string; // e.g. 'USD'

  @Prop({ type: String, required: true })
  symbol: string; // e.g. 'NGN'

  @Prop({ type: Number, required: true })
  rate: number; // mid-market, no markup

  @Prop({ type: Date, required: true })
  fetched_at: Date;
}

export const FxRateSchema = SchemaFactory.createForClass(FxRate);
FxRateSchema.index({ base: 1, symbol: 1 }, { unique: true });
