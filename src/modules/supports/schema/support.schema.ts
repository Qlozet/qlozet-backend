import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Support extends Document {
  @Prop({ required: true, trim: true })
  first_name: string;

  @Prop({ required: true, trim: true })
  last_name: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  message: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ trim: true })
  phone_number?: string;
  @Prop({ type: Types.ObjectId, ref: 'Business', required: false })
  business?: Types.ObjectId;
  @Prop({ trim: true })
  zoho_ticket_id?: string;
}
export type SupportDocument = Support & Document;
export const SupportSchema = SchemaFactory.createForClass(Support);
