import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailLogDocument = EmailLog & Document;

export enum EmailStatus {
  /** Handed to the mail host and accepted. Not yet proof of anything. */
  SENT = 'sent',
  /** The mail host refused it, or we never reached one. */
  FAILED = 'failed',
  /** The provider confirmed it reached the recipient's server. */
  DELIVERED = 'delivered',
  /** Temporary: a full mailbox, a server having a bad day. Will retry. */
  SOFT_BOUNCE = 'soft_bounce',
  /** Permanent: the address does not exist. Stop sending to it. */
  HARD_BOUNCE = 'hard_bounce',
  /** The recipient marked it as spam. Worse than a bounce for the domain. */
  COMPLAINT = 'complaint',
}

/**
 * A record that an email was attempted.
 *
 * Until now every send went to console and vanished, which made the one
 * question support actually gets — "did the vendor ever receive the new-order
 * email?" — unanswerable. Eighteen emails now carry money and deadlines, so
 * the answer needs to survive a restart.
 *
 * Deliberately records the attempt, not the delivery. Handing a message to an
 * SMTP server is not the same as it reaching an inbox: a bounce happens later
 * and out of band. `sent` here means "accepted by the mail host", which is the
 * most this layer can honestly claim — knowing more needs a provider with
 * webhooks, and this is the table those would write into.
 */
@Schema({ timestamps: true })
export class EmailLog {
  @Prop({ required: true, index: true })
  to: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true, enum: EmailStatus, index: true })
  status: EmailStatus;

  /** Why it failed, when it did. Absent on success. */
  @Prop({ type: String, default: null })
  error?: string | null;

  /**
   * The provider's own id for the message, learned from its webhook rather
   * than at send time. Kept so a row can be matched back to what ZeptoMail
   * shows in its console when the two disagree.
   */
  @Prop({ type: String, default: null, index: true })
  provider_reference?: string | null;

  /** When the provider last told us something about this message. */
  @Prop({ type: Date, default: null })
  status_updated_at?: Date | null;

  /**
   * Kept for 90 days. These are an operational breadcrumb, not a record worth
   * holding indefinitely, and they carry an email address — so they expire
   * rather than accumulate.
   */
  @Prop({ type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 })
  createdAt?: Date;
}

export const EmailLogSchema = SchemaFactory.createForClass(EmailLog);
