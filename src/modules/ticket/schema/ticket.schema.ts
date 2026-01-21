import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { TicketReply } from './reply-ticket.schema';

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

@Schema({ timestamps: true })
export class Ticket extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;

  @Prop({ required: true })
  issue_type: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  @Prop({ enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assigned_to: Types.ObjectId;

  @Prop({ default: false })
  is_resolved: boolean;
  @Prop({ type: [Types.ObjectId], ref: 'TicketReply', default: [] })
  replies: Types.ObjectId[];
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
