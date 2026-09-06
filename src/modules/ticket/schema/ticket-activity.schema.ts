import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum TicketActivityType {
  CREATED = 'created',
  REPLIED = 'replied',
  ATTACHMENT_ADDED = 'attachment_added',
  NOTE_ADDED = 'note_added',
  ASSIGNED = 'assigned',
  STATUS_CHANGED = 'status_changed',
  RESOLVED = 'resolved',
}

/**
 * Append-only audit log for a ticket. Rows are written as fire-and-forget
 * side effects of ticket mutations — a logging hiccup must never fail the
 * action itself. Tickets that predate the log get a baseline timeline
 * synthesized at read time from the ticket + its replies.
 */
@Schema({ timestamps: true })
export class TicketActivity extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true, index: true })
  ticket: Types.ObjectId;

  /** Who did it. Null → the system (or an unattributable legacy event). */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actor: Types.ObjectId | null;

  /** Fallback display name when there is no User actor (e.g. a vendor business). */
  @Prop({ type: String, default: null })
  actor_label: string | null;

  @Prop({ enum: TicketActivityType, required: true })
  type: TicketActivityType;

  /** Human-readable action sentence; note bodies live here too. */
  @Prop({ required: true })
  description: string;

  /** Structured extras: { from, to, assignee, attachments: [urls] … } */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, any>;
}

export const TicketActivitySchema =
  SchemaFactory.createForClass(TicketActivity);
