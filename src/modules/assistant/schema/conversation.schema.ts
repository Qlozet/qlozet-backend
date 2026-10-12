import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type AssistantRole = 'user' | 'assistant';

/**
 * One turn in a vendor ↔ assistant conversation. We persist the rendered text
 * only (not raw tool payloads), plus which tools ran — enough to replay context
 * and audit accuracy, without hoarding PII-laden tool results.
 */
@Schema({ _id: false, timestamps: false })
export class AssistantMessage {
  @Prop({ type: String, enum: ['user', 'assistant'], required: true })
  role: AssistantRole;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: [String], default: [] })
  tools_used: string[];

  // Optional chart specs the assistant chose to render inline with this answer.
  // Shape: { type: 'bar'|'line'|'pie', title, data: [{label, value}] }.
  @Prop({ type: [Object], default: [] })
  charts: Record<string, any>[];

  // Actions the assistant PREPARED with this answer, as cards. Copies of the
  // AssistantAction records (which stay the truth); status is synced back so
  // a reopened thread shows what happened. Shape: AssistantActionCard.
  @Prop({ type: [Object], default: [] })
  actions?: Record<string, any>[];

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}
export const AssistantMessageSchema =
  SchemaFactory.createForClass(AssistantMessage);

@Schema({ timestamps: true, collection: 'assistant_conversations' })
export class AssistantConversation extends Document {
  // Scoped to the vendor's business. Every vendor read filters on this.
  // Null for platform-admin conversations (scoped by admin_user instead).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null, index: true })
  business: Types.ObjectId | null;

  // Platform-admin conversations are personal to the admin who asked.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null, index: true })
  admin_user: Types.ObjectId | null;

  @Prop({ type: String, default: 'New conversation' })
  title: string;

  @Prop({ type: [AssistantMessageSchema], default: [] })
  messages: AssistantMessage[];

  @Prop({ type: Date, default: () => new Date() })
  last_message_at: Date;
}
export const AssistantConversationSchema = SchemaFactory.createForClass(
  AssistantConversation,
);

/**
 * A generated weekly digest for a vendor. Served to the vendor app (profile-sheet
 * tasks area and/or a header badge). `read` drives the unread indicator.
 */
@Schema({ timestamps: true, collection: 'assistant_digests' })
export class AssistantDigest extends Document {
  /** The vendor the digest is for; null for the platform-wide admin brief. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null, index: true })
  business: Types.ObjectId | null;

  /** 'vendor' (weekly, per business) or 'admin' (daily, platform-wide). */
  @Prop({ type: String, enum: ['vendor', 'admin'], default: 'vendor', index: true })
  scope: 'vendor' | 'admin';

  /** Admin brief only: who has read it - the brief is shared, the read state is not. */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  read_by: Types.ObjectId[];

  // Human summary paragraph.
  @Prop({ type: String, required: true })
  summary: string;

  // Structured, tappable recommendations the UI can render as tasks.
  @Prop({
    type: [
      {
        label: { type: String, required: true },
        detail: { type: String, default: '' },
        // Optional deep-link hint for the frontend (e.g. 'inventory', 'orders').
        action: { type: String, default: '' },
        // Admin brief: the question "Ask assistant" sends about this item.
        question: { type: String, default: '' },
      },
    ],
    default: [],
  })
  recommendations: { label: string; detail: string; action: string; question?: string }[];

  // The raw metrics the summary was built from (for display / drill-down).
  @Prop({ type: Object, default: {} })
  metrics: Record<string, any>;

  // ISO week key (e.g. '2026-W31') — used to avoid regenerating the same week.
  @Prop({ type: String, required: true, index: true })
  period_key: string;

  @Prop({ type: Boolean, default: false })
  read: boolean;
}
export const AssistantDigestSchema =
  SchemaFactory.createForClass(AssistantDigest);
