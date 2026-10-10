import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

/** How long a stylist conversation is kept. */
export const ASK_CONVERSATION_TTL_DAYS = 180;

@Schema({ _id: false })
export class AskTurn {
  @Prop({ type: String, enum: ['user', 'assistant'], required: true })
  role: 'user' | 'assistant';

  @Prop({ type: String, required: true })
  content: string;

  /**
   * The products an assistant reply surfaced, by id. Stored as ids rather
   * than copies so a resumed conversation shows the live product - current
   * price, current stock - not a snapshot of it.
   */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'Product', default: [] })
  product_ids: Types.ObjectId[];

  @Prop({ type: Date, default: () => new Date() })
  at: Date;
}
export const AskTurnSchema = SchemaFactory.createForClass(AskTurn);

export type AskConversationDocument = AskConversation & Document;

/**
 * A customer's conversation with the AI stylist.
 *
 * Until now the thread lived in a React useState on the search page and the
 * server kept nothing - the client re-sent prior turns with every request.
 * Reload, navigate away, or ask about a new search, and the conversation was
 * gone on both ends. This is the record that makes the clock button on the
 * search page mean something.
 *
 * Owned by one user and only ever read back to that user. Kept for
 * ASK_CONVERSATION_TTL_DAYS and then dropped by the TTL index, because a
 * shopping conversation is personal data and should not accumulate forever.
 */
@Schema({ timestamps: true })
export class AskConversation {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  /** The first question, trimmed - what the history list shows. */
  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: [AskTurnSchema], default: [] })
  messages: AskTurn[];

  @Prop({ type: Date, default: () => new Date(), index: true })
  last_message_at: Date;

  @Prop({ type: Date })
  createdAt: Date;
}

export const AskConversationSchema = SchemaFactory.createForClass(AskConversation);

// The history list: this user's conversations, most recent first.
AskConversationSchema.index({ user: 1, last_message_at: -1 });
// Retention.
AskConversationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ASK_CONVERSATION_TTL_DAYS * 24 * 60 * 60 },
);
