import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ReservationStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export type FabricReservationDocument = FabricReservation & Document;

@Schema({ timestamps: true })
export class FabricReservation {
  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  organizer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  fabric: Types.ObjectId;

  @Prop({ required: true, trim: true })
  event_name: string;

  @Prop({ required: true, min: 1 })
  total_yards: number;

  @Prop({ default: 0, min: 0 })
  claimed_yards: number;

  @Prop({ required: true, min: 0 })
  price_per_yard: number;

  @Prop({ required: true, min: 0 })
  reservation_fee: number;

  @Prop({ type: Types.ObjectId, ref: 'Transaction', default: null })
  fee_transaction: Types.ObjectId;

  @Prop({ required: true })
  deadline: Date;

  @Prop({
    type: String,
    enum: Object.values(ReservationStatus),
    default: ReservationStatus.ACTIVE,
  })
  status: ReservationStatus;
}

export const FabricReservationSchema =
  SchemaFactory.createForClass(FabricReservation);
