import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export const ASSISTANT_ACTION_KINDS = [
  'confirm_order',
  'reply_to_quote',
  'update_stock',
  'create_discount',
] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

export const ASSISTANT_ACTION_STATUSES = [
  'proposed',
  'executed',
  'failed',
  'cancelled',
  'expired',
] as const;
export type AssistantActionStatus = (typeof ASSISTANT_ACTION_STATUSES)[number];

/** How long a prepared action waits for a decision before it lapses. */
export const ASSISTANT_ACTION_TTL_HOURS = 24;

/**
 * An action the assistant PREPARED and the vendor must CONFIRM.
 *
 * The model never executes anything. It calls propose_action, the service
 * validates the request against the vendor's real data, stores this record
 * and shows the vendor a card. Only an explicit confirm from the vendor's own
 * session executes it - through the same service methods the dashboard uses,
 * so every existing rule still applies. The record is the audit trail: what
 * was proposed, from which conversation, who confirmed it, what happened.
 */
@Schema({ timestamps: true, collection: 'assistant_actions' })
export class AssistantAction extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', required: true, index: true })
  business: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'AssistantConversation', default: null })
  conversation: Types.ObjectId | null;

  @Prop({ type: String, enum: ASSISTANT_ACTION_KINDS, required: true })
  kind: AssistantActionKind;

  /** Card heading, e.g. "Confirm 2 orders". */
  @Prop({ type: String, required: true })
  title: string;

  /** One-line plain-English statement of exactly what will happen. */
  @Prop({ type: String, required: true })
  summary: string;

  /** Label/value rows the card shows so the vendor can check the facts. */
  @Prop({ type: [{ label: String, value: String }], default: [] })
  details: { label: string; value: string }[];

  /** Everything execute() needs, already validated and resolved to ids. */
  @Prop({ type: Object, default: {} })
  params: Record<string, any>;

  @Prop({ type: String, enum: ASSISTANT_ACTION_STATUSES, default: 'proposed', index: true })
  status: AssistantActionStatus;

  @Prop({ type: Object, default: null })
  result: Record<string, any> | null;

  /** Short human line for the card after execution ("Confirmed QLZ-123"). */
  @Prop({ type: String, default: null })
  result_text: string | null;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  confirmed_by: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  decided_at: Date | null;

  @Prop({ type: Date, required: true })
  expires_at: Date;
}

export const AssistantActionSchema = SchemaFactory.createForClass(AssistantAction);

/** What the chat shows and stores inline with the assistant's message. */
export interface AssistantActionCard {
  action_id: string;
  kind: AssistantActionKind;
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  status: AssistantActionStatus;
  result_text: string | null;
  error: string | null;
  expires_at: string;
}

export function toCard(doc: AssistantAction): AssistantActionCard {
  return {
    action_id: String(doc._id),
    kind: doc.kind,
    title: doc.title,
    summary: doc.summary,
    details: (doc.details || []).map((d) => ({ label: d.label, value: d.value })),
    status: doc.status,
    result_text: doc.result_text ?? null,
    error: doc.error ?? null,
    expires_at: doc.expires_at?.toISOString?.() ?? String(doc.expires_at),
  };
}
