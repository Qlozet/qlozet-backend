import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class TicketReply extends Document {
  // Was a dangling double-@Prop with ref 'TicketReply' — a reply pointing at
  // the replies collection instead of the ticket it belongs to.
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true, index: true })
  ticket_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ required: true })
  message: string;

  @Prop({ type: [String], default: [] })
  attachments: string[];
}

export const TicketReplySchema = SchemaFactory.createForClass(TicketReply);
