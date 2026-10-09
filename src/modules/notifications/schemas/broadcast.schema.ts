import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

/** Who a broadcast goes to. Maps onto UserType. */
export enum BroadcastAudience {
  CUSTOMERS = 'customers',
  VENDORS = 'vendors',
  ADMINS = 'admins',
}

export enum BroadcastStatus {
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export type BroadcastDocument = Broadcast & Document;

/**
 * An announcement an admin sends to everyone in one audience.
 *
 * This replaces a settings grid that let an admin toggle individual
 * notification types on and off. That was the wrong shape twice over: it
 * persisted nothing, and most of what it offered should never be switchable —
 * "order shipped" is an obligation to the customer, not a preference. What was
 * actually missing was the opposite: a way to say something to everyone.
 *
 * Kept as a record rather than fired and forgotten, because a message sent to
 * every customer is the kind of thing you need to be able to look back at, and
 * because a scheduled send needs somewhere to wait.
 */
@Schema({ timestamps: true })
export class Broadcast {
  @Prop({ type: String, required: true, trim: true })
  subject: string;

  /** Rich text from the composer. Rendered into the email shell as-is. */
  @Prop({ type: String, required: true })
  body: string;

  @Prop({
    type: String,
    enum: Object.values(BroadcastAudience),
    required: true,
    index: true,
  })
  audience: BroadcastAudience;

  /**
   * In-app is always on — a broadcast with no delivery at all is not a
   * broadcast. Email is opt-in per send, because emailing every customer is a
   * different order of commitment from adding a bell row.
   */
  @Prop({ type: Boolean, default: true })
  send_email: boolean;

  @Prop({
    type: String,
    enum: Object.values(BroadcastStatus),
    default: BroadcastStatus.SENDING,
    index: true,
  })
  status: BroadcastStatus;

  /** Unset means send immediately. */
  @Prop({ type: Date, default: null, index: true })
  scheduled_at: Date | null;

  @Prop({ type: Date, default: null })
  sent_at: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  created_by: Types.ObjectId;

  /** Snapshot of who sent it, so the history reads without a join. */
  @Prop({ type: String })
  created_by_name?: string;

  @Prop({ type: Number, default: 0 })
  recipient_count: number;

  @Prop({ type: Number, default: 0 })
  emails_sent: number;

  @Prop({ type: Number, default: 0 })
  emails_failed: number;

  @Prop({ type: String, default: null })
  error: string | null;
}

export const BroadcastSchema = SchemaFactory.createForClass(Broadcast);

// The admin history list, newest first.
BroadcastSchema.index({ createdAt: -1 });
// The cron's only query: what is due.
BroadcastSchema.index({ status: 1, scheduled_at: 1 });
