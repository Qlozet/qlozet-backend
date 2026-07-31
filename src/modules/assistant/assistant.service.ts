import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  AssistantConversation,
  AssistantMessage,
} from './schema/conversation.schema';
import {
  LLM_PROVIDER,
  LlmMessage,
  LlmProvider,
} from './llm/llm-provider.interface';
import { AnalyticsToolsService } from './tools/analytics-tools.service';
import { buildSystemPrompt } from './assistant.prompt';
import { TokenService } from '../wallets/token.service';

// How many prior turns to replay as context. Fresh numbers always come from
// tool re-fetch, so we don't need deep history.
const HISTORY_TURNS = 12;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @InjectModel(AssistantConversation.name)
    private readonly conversationModel: Model<AssistantConversation>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly tools: AnalyticsToolsService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
  ) {}

  private get smartModel(): string {
    return (
      this.config.get<string>('ASSISTANT_MODEL') ?? 'claude-sonnet-5'
    );
  }

  private meteringEnabled(): boolean {
    return this.config.get<string>('ASSISTANT_METERING_ENABLED') !== 'false';
  }

  private freeDailyQueries(): number {
    return Number(this.config.get<string>('ASSISTANT_FREE_DAILY_QUERIES') ?? 5);
  }

  /** Count this business's user messages since local midnight (free-tier gate). */
  private async usedToday(businessId: Types.ObjectId): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const agg = await this.conversationModel.aggregate([
      { $match: { business: businessId } },
      { $unwind: '$messages' },
      {
        $match: {
          'messages.role': 'user',
          'messages.createdAt': { $gte: start },
        },
      },
      { $count: 'n' },
    ]);
    return agg[0]?.n ?? 0;
  }

  /**
   * Handle one vendor question end-to-end: meter, run the tool loop, persist.
   * Returns the assistant's answer + conversation id + tools used.
   */
  async chat(
    businessId: string,
    message: string,
    conversationId?: string,
    businessName?: string,
  ) {
    if (!businessId) throw new BadRequestException('Missing business context.');
    const text = (message ?? '').trim();
    if (!text) throw new BadRequestException('Message is required.');
    const bid = new Types.ObjectId(businessId);

    // ── Metering: free daily allowance, then spend ai_ask tokens ─────────────
    let charged = false;
    if (this.meteringEnabled()) {
      const used = await this.usedToday(bid);
      if (used >= this.freeDailyQueries()) {
        try {
          await this.tokenService.spend('ai_ask', businessId);
          charged = true;
        } catch (e: any) {
          throw new BadRequestException(
            e?.message?.includes('Insufficient')
              ? "You've used your free questions for today and are out of tokens. Top up tokens to keep asking."
              : e?.message ?? 'Unable to start the assistant.',
          );
        }
      }
    }

    try {
      const conversation = await this.getOrCreateConversation(bid, conversationId);

      // Build history (plain text) + the new question.
      const history: LlmMessage[] = conversation.messages
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: 'user', content: text });

      const result = await this.llm.runToolLoop({
        system: buildSystemPrompt(businessName),
        messages: history,
        tools: this.tools.getToolDefs(),
        onToolCall: (name, input) => this.tools.execute(name, businessId, input),
        model: this.smartModel,
        maxTokens: 1024,
        maxTurns: 6,
      });

      const answer =
        result.text ||
        "I couldn't find anything to answer that. Try rephrasing.";

      // Persist both turns.
      conversation.messages.push({
        role: 'user',
        content: text,
        tools_used: [],
        createdAt: new Date(),
      } as AssistantMessage);
      conversation.messages.push({
        role: 'assistant',
        content: answer,
        tools_used: result.toolsUsed,
        createdAt: new Date(),
      } as AssistantMessage);
      conversation.last_message_at = new Date();
      if (conversation.title === 'New conversation') {
        conversation.title = text.slice(0, 60);
      }
      await conversation.save();

      return {
        conversation_id: (conversation._id as any).toString(),
        answer,
        tools_used: result.toolsUsed,
      };
    } catch (err) {
      // Refund the token if the run failed after we charged.
      if (charged) {
        try {
          await this.tokenService.refund('ai_ask', businessId);
        } catch (e: any) {
          this.logger.error(`ai_ask refund failed: ${e?.message}`);
        }
      }
      throw err;
    }
  }

  private async getOrCreateConversation(
    bid: Types.ObjectId,
    conversationId?: string,
  ): Promise<AssistantConversation> {
    if (conversationId) {
      const existing = await this.conversationModel.findOne({
        _id: conversationId,
        business: bid, // tenant scope: can't load another vendor's thread
      });
      if (!existing) throw new NotFoundException('Conversation not found.');
      return existing;
    }
    return this.conversationModel.create({ business: bid, messages: [] });
  }

  async listConversations(businessId: string, page = 1, size = 20) {
    const bid = new Types.ObjectId(businessId);
    const skip = (page - 1) * size;
    const [items, total] = await Promise.all([
      this.conversationModel
        .find({ business: bid })
        .select('title last_message_at createdAt')
        .sort({ last_message_at: -1 })
        .skip(skip)
        .limit(size)
        .lean(),
      this.conversationModel.countDocuments({ business: bid }),
    ]);
    return { total, page, size, items };
  }

  async getConversation(businessId: string, conversationId: string) {
    const convo = await this.conversationModel
      .findOne({ _id: conversationId, business: new Types.ObjectId(businessId) })
      .lean();
    if (!convo) throw new NotFoundException('Conversation not found.');
    return convo;
  }
}
