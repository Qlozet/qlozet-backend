import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class TicketReply extends Document {
  @Prop({ required: true })
  @Prop({ type: Types.ObjectId, ref: 'TicketReply', required: true })
  ticket_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ required: true })
  message: string;

  @Prop({ type: [String], default: [] })
  attachments: string[];
}

export const TicketReplySchema = SchemaFactory.createForClass(TicketReply);
