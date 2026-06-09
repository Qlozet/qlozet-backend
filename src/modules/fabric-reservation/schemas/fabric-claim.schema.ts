import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FabricClaimDocument = FabricClaim & Document;

@Schema({ timestamps: true })
export class FabricClaim {
  @Prop({ type: Types.ObjectId, ref: 'FabricReservation', required: true })
  reservation: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  guest: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  order: Types.ObjectId;

  @Prop({ required: true, min: 0.1 })
  yards_claimed: number;

  @Prop({ required: true, min: 0 })
  total_amount: number;
}

export const FabricClaimSchema = SchemaFactory.createForClass(FabricClaim);
