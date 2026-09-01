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

  // Set by the payment webhook once the guest's charge settles. Yards are
  // held from the moment of claiming (so two guests can't race for the same
  // cut), but an unpaid claim is released back by cron after a grace window.
  @Prop({ default: false })
  paid: boolean;

  // True once an unpaid claim's yards have been released back to the
  // reservation — prevents double-release and excludes it from progress.
  @Prop({ default: false })
  released: boolean;
}

export const FabricClaimSchema = SchemaFactory.createForClass(FabricClaim);
