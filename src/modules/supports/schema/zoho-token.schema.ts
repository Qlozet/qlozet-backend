import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class ZohoToken extends Document {
  @Prop({ type: String, required: true })
  access_token: string;

  @Prop({ type: String, required: true })
  refresh_token: string;

  @Prop({ type: Date, required: true })
  expires_at: Date;
}

export type ZohoTokenDocument = ZohoToken & Document;
export const ZohoTokenSchema = SchemaFactory.createForClass(ZohoToken);
