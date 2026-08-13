import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { AssistantDigest } from './schema/conversation.schema';
import { AnalyticsToolsService } from './tools/analytics-tools.service';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider.interface';
import { buildDigestPrompt } from './assistant.prompt';

/**
 * Builds and stores per-vendor weekly digests. Kept separate from the cron so it
 * can also be triggered on demand (admin/test) and unit-tested. One digest per
 * business per ISO week (idempotent on period_key).
 */
@Injectable()
export class AssistantDigestService {
  private readonly logger = new Logger(AssistantDigestService.name);

  constructor(
    @InjectModel(AssistantDigest.name)
    private readonly digestModel: Model<AssistantDigest>,
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly tools: AnalyticsToolsService,
    private readonly config: ConfigService,
  ) {}

  private get fastModel(): string {
    return this.config.get<string>('ASSISTANT_DIGEST_MODEL') ?? 'claude-haiku-4-5-20251001';
  }

  // ISO-week key like "2026-W31" (stable; injected `now` keeps it testable).
  static periodKey(now: Date): string {
    const d = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
    );
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((d.getTime() - firstThursday.getTime()) / 86400000 -
          3 +
          ((firstThursday.getUTCDay() + 6) % 7)) /
          7,
      );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  /** Vendors with at least one order in the last 30 days = "active". */
  async findActiveBusinessIds(now: Date): Promise<Types.ObjectId[]> {
    const since = new Date(now);
    since.setDate(now.getDate() - 30);
    const rows = await this.orderModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.business' } },
    ]);
    return rows.map((r) => r._id).filter(Boolean);
  }

  /** Gather the metrics a digest is built from, all scoped to the business. */
  private async gatherMetrics(businessId: string) {
    // The digest summarises the week that just ended, so it must look BACK a
    // full 7 days — not `this_week`, which is week-to-date and resolves to an
    // empty [now, now) window at the Sunday-00:00 cron time, making every
    // vendor look like they had zero orders (the bug behind "no digest ever").
    const [lastWeek, topProducts, payout] = await Promise.all([
      this.tools.execute('get_sales_summary', businessId, {
        period: 'last_7_days',
      }),
      this.tools.execute('get_top_products', businessId, {
        period: 'last_7_days',
        limit: 3,
      }),
      this.tools.execute('get_payout_forecast', businessId, {}),
    ]);
    return {
      sales_last_7_days: lastWeek?.data,
      top_products: topProducts?.data,
      payout: payout?.data,
    };
  }

  private safeParse(text: string): {
    summary: string;
    recommendations: { label: string; detail: string; action: string }[];
  } {
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const json = start >= 0 ? text.slice(start, end + 1) : text;
      const parsed = JSON.parse(json);
      return {
        summary: String(parsed.summary ?? '').trim(),
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations.slice(0, 3).map((r: any) => ({
              label: String(r.label ?? '').trim(),
              detail: String(r.detail ?? '').trim(),
              action: String(r.action ?? '').trim(),
            }))
          : [],
      };
    } catch {
      return { summary: text.trim().slice(0, 500), recommendations: [] };
    }
  }

  /** Generate (or return existing) this week's digest for one business. */
  async generateForBusiness(
    businessId: string,
    now: Date = new Date(),
  ): Promise<AssistantDigest | null> {
    const bid = new Types.ObjectId(businessId);
    const period_key = AssistantDigestService.periodKey(now);

    const existing = await this.digestModel.findOne({
      business: bid,
      period_key,
    });
    if (existing) return existing;

    const metrics = await this.gatherMetrics(businessId);

    // Skip vendors with a completely empty week — nothing worth sending.
    if (
      !metrics.sales_last_7_days ||
      metrics.sales_last_7_days.order_count === 0
    ) {
      return null;
    }

    const result = await this.llm.complete({
      system: buildDigestPrompt(),
      messages: [
        { role: 'user', content: JSON.stringify(metrics) },
      ],
      model: this.fastModel,
      maxTokens: 400,
    });

    const parsed = this.safeParse(result.text);
    if (!parsed.summary) return null;

    return this.digestModel.create({
      business: bid,
      summary: parsed.summary,
      recommendations: parsed.recommendations,
      metrics,
      period_key,
      read: false,
    });
  }

  /** Run the digest for every active vendor this week. Returns counts. */
  async generateAll(now: Date = new Date()) {
    const ids = await this.findActiveBusinessIds(now);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const d = await this.generateForBusiness(id.toString(), now);
        if (d) created++;
        else skipped++;
      } catch (e: any) {
        failed++;
        this.logger.error(`[Digest] ${id} failed: ${e?.message}`);
      }
    }
    this.logger.log(
      `[Digest] active=${ids.length} created=${created} skipped=${skipped} failed=${failed}`,
    );
    return { active: ids.length, created, skipped, failed };
  }

  // ── Read APIs for the vendor app ───────────────────────────────────────────
  async latest(businessId: string) {
    const bid = new Types.ObjectId(businessId);
    const digest = await this.digestModel
      .findOne({ business: bid })
      .sort({ createdAt: -1 })
      .lean();
    const unread = await this.digestModel.countDocuments({
      business: bid,
      read: false,
    });
    return { digest, unread };
  }

  async markRead(businessId: string, digestId: string) {
    const res = await this.digestModel.findOneAndUpdate(
      { _id: digestId, business: new Types.ObjectId(businessId) },
      { $set: { read: true } },
      { new: true },
    );
    if (!res) throw new NotFoundException('Digest not found.');
    return res;
  }
}
