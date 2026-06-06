import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WaitlistDocument = HydratedDocument<Waitlist>;

export enum WaitlistType {
  CUSTOMER = 'customer',
  VENDOR = 'vendor',
}

@Schema({ timestamps: true })
export class Waitlist {
  @Prop({ required: true, enum: WaitlistType })
  type: WaitlistType;

  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  businessName?: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  businessType?: string;
}

export const WaitlistSchema = SchemaFactory.createForClass(Waitlist);
