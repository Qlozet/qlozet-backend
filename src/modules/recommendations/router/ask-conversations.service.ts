import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AskConversation,
  AskConversationDocument,
  AskTurn,
} from './schemas/ask-conversation.schema';

export type StoredTurn = { role: 'user' | 'assistant'; content: string };

/** What the history list shows per row. */
export interface ConversationSummary {
  _id: string;
  title: string;
  message_count: number;
  last_message_at: Date;
  createdAt: Date;
}

const TITLE_MAX = 80;

/**
 * Stylist conversations, per customer.
 *
 * Deliberately a separate service from AskService: that one is the AI
 * pipeline (retrieval, prompt, guardrails) and should not know whether a
 * conversation is being remembered. This is the memory. The controller wires
 * the two together: it asks this for the stored turns before calling the
 * pipeline, and hands the result back here afterwards.
 */
@Injectable()
export class AskConversationsService {
  private readonly logger = new Logger(AskConversationsService.name);

  constructor(
    @InjectModel(AskConversation.name)
    private readonly model: Model<AskConversationDocument>,
  ) {}

  /**
   * The prior turns of a conversation, as the pipeline wants them.
   *
   * Server truth beats whatever the client re-sent: a resumed conversation
   * from another device has no client-side copy at all.
   */
  async historyFor(userId: string, conversationId: string): Promise<StoredTurn[]> {
    const doc = await this.owned(userId, conversationId);
    return doc.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  /**
   * Record one exchange. Creates the conversation on the first exchange and
   * returns its id either way, so the client only has to hold on to one
   * string. Never throws: the answer has already been produced and paid for,
   * and failing to remember it must not fail the request.
   */
  async record(
    userId: string,
    conversationId: string | null | undefined,
    question: string,
    reply: string,
    productIds: (string | Types.ObjectId)[] = [],
  ): Promise<string | null> {
    try {
      const now = new Date();
      const userTurn: AskTurn = {
        role: 'user',
        content: question,
        product_ids: [],
        at: now,
      };
      const assistantTurn: AskTurn = {
        role: 'assistant',
        content: reply,
        product_ids: productIds
          .filter((id) => Types.ObjectId.isValid(String(id)))
          .map((id) => new Types.ObjectId(String(id))),
        at: now,
      };

      if (conversationId && Types.ObjectId.isValid(conversationId)) {
        const updated = await this.model.findOneAndUpdate(
          { _id: conversationId, user: new Types.ObjectId(userId) },
          {
            $push: { messages: { $each: [userTurn, assistantTurn] } },
            $set: { last_message_at: now },
          },
          { new: true },
        );
        if (updated) return String(updated._id);
        // Not theirs, or gone (TTL) - start a fresh one rather than erroring
        // out of a question that was already answered.
      }

      const created = await this.model.create({
        user: new Types.ObjectId(userId),
        title: this.titleFrom(question),
        messages: [userTurn, assistantTurn],
        last_message_at: now,
      });
      return String(created._id);
    } catch (err: any) {
      this.logger.warn(`Could not record stylist conversation: ${err?.message}`);
      return null;
    }
  }

  async list(userId: string, limit = 30): Promise<ConversationSummary[]> {
    const rows = await this.model
      .find({ user: new Types.ObjectId(userId) })
      .sort({ last_message_at: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .select('title messages last_message_at createdAt')
      .lean();
    return rows.map((r: any) => ({
      _id: String(r._id),
      title: r.title,
      message_count: Array.isArray(r.messages) ? r.messages.length : 0,
      last_message_at: r.last_message_at,
      createdAt: r.createdAt,
    }));
  }

  /**
   * One conversation, with the products of its latest reply populated so the
   * client can show the same grid it showed the first time.
   */
  async get(userId: string, conversationId: string) {
    const doc = await this.owned(userId, conversationId);
    const populated: any = await this.model
      .findById(doc._id)
      .populate({
        path: 'messages.product_ids',
        // Same projection the ask pipeline hydrates with, so a resumed reply
        // renders exactly as it did the first time.
        select:
          'name kind base_price discounted_price business clothing fabric accessory status ' +
          'average_rating total_ratings slug description',
        populate: { path: 'business', select: 'business_name business_logo_url' },
      })
      .lean();

    const messages = (populated?.messages ?? []).map((m: any) => ({
      role: m.role,
      content: m.content,
      at: m.at,
      products: Array.isArray(m.product_ids)
        ? m.product_ids.filter((p: any) => p && typeof p === 'object')
        : [],
    }));

    return {
      _id: String(doc._id),
      title: doc.title,
      last_message_at: doc.last_message_at,
      messages,
    };
  }

  async remove(userId: string, conversationId: string) {
    const doc = await this.owned(userId, conversationId);
    await this.model.deleteOne({ _id: doc._id });
    return { deleted: true };
  }

  async removeAll(userId: string) {
    const res = await this.model.deleteMany({ user: new Types.ObjectId(userId) });
    return { deleted: res.deletedCount ?? 0 };
  }

  /** Found, and this user's. A conversation that is someone else's is a 404,
   *  not a 403 - its existence is not theirs to learn either. */
  private async owned(userId: string, conversationId: string) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation not found');
    }
    const doc = await this.model.findById(conversationId);
    if (!doc) throw new NotFoundException('Conversation not found');
    if (String(doc.user) !== String(userId)) {
      throw new NotFoundException('Conversation not found');
    }
    return doc;
  }

  private titleFrom(question: string): string {
    const t = question.replace(/\s+/g, ' ').trim();
    return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX).trimEnd()}…` : t || 'Conversation';
  }
}
