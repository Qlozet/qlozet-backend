import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { AssistantDigest } from './schema/conversation.schema';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider.interface';
import { AdminAnalyticsToolsService } from './tools/admin-analytics-tools.service';
import { AdminOpsToolsService } from './tools/admin-ops-tools.service';
import { buildAdminBriefPrompt } from './assistant.prompt';

/**
 * The admin morning brief: one platform-wide digest a day, built from the
 * same tools the assistant answers with, so what it says and what the
 * assistant would say never disagree. Each recommendation carries the
 * question to ask the assistant about it, which is what the "Ask" button
 * on the console sends.
 *
 * Stored as an AssistantDigest with scope 'admin' and no business; read
 * state is per admin (read_by), since the brief is shared.
 */
@Injectable()
export class AssistantBriefService {
  private readonly logger = new Logger(AssistantBriefService.name);

  constructor(
    @InjectModel(AssistantDigest.name) private readonly digestModel: Model<AssistantDigest>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly analytics: AdminAnalyticsToolsService,
    private readonly ops: AdminOpsToolsService,
    private readonly config: ConfigService,
  ) {}

  private get fastModel(): string {
    return this.config.get<string>('ASSISTANT_DIGEST_MODEL') ?? 'claude-haiku-4-5-20251001';
  }

  /** One brief per platform day. */
  static periodKey(now: Date): string {
    return new Date(now.getTime() + 60 * 60_000).toISOString().slice(0, 10); // Africa/Lagos date
  }

  private isoDay(d: Date) {
    return d.toISOString().slice(0, 10);
  }

  /** Everything the brief is written from - all through the tools, all platform-wide (super-admin view). */
  async gatherMetrics(now: Date = new Date()) {
    const day = 86_400_000;
    const yesterday = new Date(now.getTime() - day);
    const dayBefore = new Date(now.getTime() - 2 * day);
    const [yesterdaySummary, dayBeforeSummary, weekSummary, queue, stuck, health, reconciliation, gaps] = await Promise.all([
      this.analytics.execute('get_platform_summary', { start_date: this.isoDay(yesterday), end_date: this.isoDay(yesterday) }, null),
      this.analytics.execute('get_platform_summary', { start_date: this.isoDay(dayBefore), end_date: this.isoDay(dayBefore) }, null),
      this.analytics.execute('get_platform_summary', { period: 'last_7_days' }, null),
      this.ops.execute('get_work_queue', { limit: 5 }, null),
      this.ops.execute('get_stuck_orders', { limit: 5 }, null),
      this.ops.execute('get_vendor_health', { period: 'last_30_days' }, null),
      this.ops.execute('get_payment_reconciliation', { period: 'last_7_days' }, null),
      this.ops.execute('get_search_gaps', { period: 'last_7_days', limit: 5 }, null),
    ]);
    const counts = (sections: any) =>
      Object.fromEntries(
        Object.entries(sections ?? {}).map(([k, v]: [string, any]) => [
          k,
          typeof v?.count === 'number' ? v.count : Object.fromEntries(Object.entries(v ?? {}).filter(([, x]: [string, any]) => typeof x?.count === 'number').map(([kk, x]: [string, any]) => [kk, x.count])),
        ]),
      );
    return {
      date: this.isoDay(yesterday),
      yesterday: yesterdaySummary?.data ?? yesterdaySummary,
      day_before: dayBeforeSummary?.data ?? dayBeforeSummary,
      last_7_days: weekSummary?.data ?? weekSummary,
      work_queue: counts(queue?.sections),
      payouts_due: queue?.sections?.payouts_due ? { total_amount: queue.sections.payouts_due.total_amount, vendors: queue.sections.payouts_due.vendors } : null,
      stuck_orders: { total: stuck?.data?.total ?? 0, by_vendor: (stuck?.data?.by_vendor ?? []).slice(0, 3) },
      vendors_flagged: (health?.data?.flagged ?? []).slice(0, 5).map((v: any) => ({ vendor: v.vendor, flags: v.flags })),
      reconciliation: reconciliation?.data?.totals ?? null,
      search_gaps: (gaps?.data?.gaps ?? []).slice(0, 5),
    };
  }

  async generate(now: Date = new Date()): Promise<AssistantDigest | null> {
    const period_key = AssistantBriefService.periodKey(now);
    const existing = await this.digestModel.findOne({ scope: 'admin', period_key });
    if (existing) return existing;

    const metrics = await this.gatherMetrics(now);
    const result = await this.llm.complete({
      system: buildAdminBriefPrompt(),
      messages: [{ role: 'user', content: JSON.stringify(metrics) }],
      model: this.fastModel,
      maxTokens: 700,
    });
    const parsed = this.safeParse(result.text);
    if (!parsed.summary) return null;
    return this.digestModel.create({
      business: null,
      scope: 'admin',
      summary: parsed.summary,
      recommendations: parsed.recommendations,
      metrics,
      period_key,
      read: false,
      read_by: [],
    });
  }

  private safeParse(text: string): { summary: string; recommendations: { label: string; detail: string; action: string; question: string }[] } {
    try {
      const cleaned = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const json = JSON.parse(cleaned);
      const recs = Array.isArray(json.recommendations) ? json.recommendations : [];
      return {
        summary: String(json.summary ?? '').trim(),
        recommendations: recs.slice(0, 5).map((r: any) => ({
          label: String(r?.label ?? '').slice(0, 120),
          detail: String(r?.detail ?? '').slice(0, 400),
          action: String(r?.action ?? ''),
          question: String(r?.question ?? r?.label ?? '').slice(0, 300),
        })),
      };
    } catch {
      return { summary: '', recommendations: [] };
    }
  }

  async latest(adminId: string) {
    const brief: any = await this.digestModel.findOne({ scope: 'admin' }).sort({ createdAt: -1 }).lean();
    const unread = brief && Types.ObjectId.isValid(adminId) && !(brief.read_by ?? []).some((id: any) => String(id) === String(adminId)) ? 1 : 0;
    return { brief, unread };
  }

  async markRead(adminId: string, briefId: string) {
    if (!Types.ObjectId.isValid(adminId) || !Types.ObjectId.isValid(briefId)) throw new NotFoundException('Brief not found.');
    const res = await this.digestModel.findOneAndUpdate(
      { _id: briefId, scope: 'admin' },
      { $addToSet: { read_by: new Types.ObjectId(adminId) } },
      { new: true },
    );
    if (!res) throw new NotFoundException('Brief not found.');
    return res;
  }
}
