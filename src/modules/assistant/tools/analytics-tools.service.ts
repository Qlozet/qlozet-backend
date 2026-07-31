import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LlmToolDef } from '../llm/llm-provider.interface';
import {
  PERIOD_ENUM,
  RangeArgs,
  ResolvedRange,
  priorRange,
  resolveRange,
} from './date-range';

// Orders that represent real, paid sales (excludes unpaid/cancelled/returned).
const REVENUE_STATUSES = ['in_review', 'processing', 'in_transit', 'completed'];

// Shared date-window schema fragment (preset OR custom range).
const RANGE_PROPS = {
  period: {
    type: 'string',
    enum: [...PERIOD_ENUM],
    description:
      'Preset time window. Defaults to this_month. Ignored when start_date is given.',
  },
  start_date: {
    type: 'string',
    description: 'Custom range start (YYYY-MM-DD). Overrides period.',
  },
  end_date: {
    type: 'string',
    description: 'Custom range end (YYYY-MM-DD). Defaults to today.',
  },
};

/**
 * Read-only analytics tools for the vendor assistant. EVERY method takes the
 * authenticated `businessId` (injected by the caller, never model-supplied) and
 * hard-filters on it, so a tool can only ever return this vendor's data.
 */
@Injectable()
export class AnalyticsToolsService {
  private readonly logger = new Logger(AnalyticsToolsService.name);

  constructor(
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('BusinessEarning')
    private readonly earningModel: Model<any>,
    @InjectModel('Wallet') private readonly walletModel: Model<any>,
    @InjectModel('Transaction')
    private readonly transactionModel: Model<any>,
  ) {}

  /** Tool definitions advertised to the model. */
  getToolDefs(): LlmToolDef[] {
    return [
      {
        name: 'get_sales_summary',
        description:
          "Revenue, order count, units sold and average order value for the vendor's own items, with % change vs the prior equal-length period.",
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_top_products',
        description:
          'Best- or worst-selling products by revenue for the period (name, revenue, orders).',
        input_schema: {
          type: 'object',
          properties: {
            ...RANGE_PROPS,
            limit: { type: 'number', description: 'Max products (default 5).' },
            direction: {
              type: 'string',
              enum: ['top', 'bottom'],
              description: 'top = best sellers, bottom = worst. Default top.',
            },
          },
        },
      },
      {
        name: 'get_sales_by_location',
        description:
          'Order counts grouped by delivery state (top regions) for the period.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_sales_by_audience',
        description:
          "Sold-item split by target audience (Men/Women/Unisex) from each product's taxonomy, for the period.",
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_sales_by_product_kind',
        description:
          'Sales split by product kind (clothing / fabric / accessory), orders and revenue, for the period.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_earnings_breakdown',
        description:
          'Gross, platform commission and net earnings for the period, plus current released vs pending wallet balances.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_wallet_ledger',
        description:
          'Totals of the vendor wallet transactions by type (credit/debit/fund/refund) for the period.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_payout_forecast',
        description:
          'Available balance now, total pending earnings, and the next scheduled release date and amount. Forward-looking; ignores period.',
        input_schema: { type: 'object', properties: {} },
      },
    ];
  }

  /** Dispatch a tool call, always scoped to businessId. */
  async execute(name: string, businessId: string, args: any): Promise<any> {
    const bid = new Types.ObjectId(businessId);
    switch (name) {
      case 'get_sales_summary':
        return this.salesSummary(bid, args);
      case 'get_top_products':
        return this.topProducts(bid, args);
      case 'get_sales_by_location':
        return this.salesByLocation(bid, args);
      case 'get_sales_by_audience':
        return this.salesByAudience(bid, args);
      case 'get_sales_by_product_kind':
        return this.salesByProductKind(bid, args);
      case 'get_earnings_breakdown':
        return this.earningsBreakdown(bid, args);
      case 'get_wallet_ledger':
        return this.walletLedger(bid, args);
      case 'get_payout_forecast':
        return this.payoutForecast(bid);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private meta(range: ResolvedRange, extra: Record<string, any> = {}) {
    return {
      period: range.label,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      currency: 'NGN',
      ...extra,
    };
  }

  // ── Revenue core (reused for current + prior windows) ──────────────────────
  private async revenueFor(
    bid: Types.ObjectId,
    range: ResolvedRange,
  ): Promise<{ revenue: number; orders: number; units: number }> {
    const agg = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: range.start, $lt: range.end },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.business': bid } },
      {
        $group: {
          _id: '$_id',
          orderRevenue: { $sum: { $ifNull: ['$items.total_price', 0] } },
          units: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$orderRevenue' },
          orders: { $sum: 1 },
          units: { $sum: '$units' },
        },
      },
    ]);
    const r = agg[0] ?? {};
    return { revenue: r.revenue ?? 0, orders: r.orders ?? 0, units: r.units ?? 0 };
  }

  private pctChange(cur: number, prev: number): string {
    if (prev === 0 && cur === 0) return '0%';
    if (prev === 0) return '+100%';
    const v = ((cur - prev) / prev) * 100;
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  }

  private async salesSummary(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const prior = priorRange(range);
    const [cur, prev] = await Promise.all([
      this.revenueFor(bid, range),
      this.revenueFor(bid, prior),
    ]);
    const aov = cur.orders ? Math.round(cur.revenue / cur.orders) : 0;
    return {
      ...this.meta(range),
      data: {
        revenue: cur.revenue,
        order_count: cur.orders,
        items_sold: cur.units,
        average_order_value: aov,
        revenue_change: this.pctChange(cur.revenue, prev.revenue),
        order_count_change: this.pctChange(cur.orders, prev.orders),
      },
    };
  }

  private async topProducts(bid: Types.ObjectId, args: any) {
    const range = resolveRange(args);
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
    const asc = args.direction === 'bottom';
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: range.start, $lt: range.end },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.business': bid } },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'p',
        },
      },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$items.product',
          name: {
            $first: {
              $ifNull: [
                '$p.clothing.name',
                {
                  $ifNull: [
                    '$p.fabric.name',
                    { $ifNull: ['$p.accessory.name', 'Unknown product'] },
                  ],
                },
              ],
            },
          },
          revenue: { $sum: { $ifNull: ['$items.total_price', 0] } },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: asc ? 1 : -1 } },
      { $limit: limit },
    ]);
    return {
      ...this.meta(range, { direction: asc ? 'bottom' : 'top' }),
      data: rows.map((r) => ({
        product: r.name,
        revenue: r.revenue,
        orders: r.orders,
      })),
    };
  }

  private async salesByLocation(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: range.start, $lt: range.end },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.business': bid } },
      { $group: { _id: '$_id', state: { $first: '$address.state' } } },
      {
        $group: {
          _id: {
            $let: {
              vars: { s: { $trim: { input: { $ifNull: ['$state', ''] } } } },
              in: { $cond: [{ $eq: ['$$s', ''] }, 'Unknown', '$$s'] },
            },
          },
          orders: { $sum: 1 },
        },
      },
      { $sort: { orders: -1 } },
      { $limit: 8 },
    ]);
    return {
      ...this.meta(range),
      data: rows.map((r) => ({ state: r._id, orders: r.orders })),
    };
  }

  private async salesByAudience(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: range.start, $lt: range.end },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.business': bid } },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'p',
        },
      },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            $toLower: {
              $trim: {
                input: {
                  $ifNull: [
                    '$p.clothing.taxonomy.audience',
                    {
                      $ifNull: [
                        '$p.accessory.taxonomy.audience',
                        { $ifNull: ['$p.fabric.taxonomy.audience', ''] },
                      ],
                    },
                  ],
                },
              },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const buckets = { Men: 0, Women: 0, Unisex: 0 };
    for (const r of rows) {
      const g = (r._id || '').toLowerCase();
      if (['men', 'male', 'man', 'boys'].includes(g)) buckets.Men += r.count;
      else if (['women', 'female', 'woman', 'girls'].includes(g))
        buckets.Women += r.count;
      else buckets.Unisex += r.count;
    }
    return { ...this.meta(range), data: buckets };
  }

  private async salesByProductKind(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: range.start, $lt: range.end },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.business': bid } },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'p',
        },
      },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$p.kind', 'unknown'] },
          orders: { $sum: 1 },
          revenue: { $sum: { $ifNull: ['$items.total_price', 0] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]);
    return {
      ...this.meta(range),
      data: rows.map((r) => ({
        kind: r._id,
        orders: r.orders,
        revenue: r.revenue,
      })),
    };
  }

  private async earningsBreakdown(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const [agg, wallet] = await Promise.all([
      this.earningModel.aggregate([
        {
          $match: {
            business: bid,
            createdAt: { $gte: range.start, $lt: range.end },
          },
        },
        {
          $group: {
            _id: null,
            gross: { $sum: { $ifNull: ['$amount', 0] } },
            commission: { $sum: { $ifNull: ['$commission', 0] } },
            net: { $sum: { $ifNull: ['$net_amount', 0] } },
            released: {
              $sum: {
                $cond: [{ $eq: ['$released', true] }, '$net_amount', 0],
              },
            },
            pending: {
              $sum: {
                $cond: [{ $eq: ['$released', false] }, '$net_amount', 0],
              },
            },
          },
        },
      ]),
      this.walletModel.findOne({ business: bid }).lean(),
    ]);
    const e = agg[0] ?? {};
    return {
      ...this.meta(range),
      data: {
        gross_sales: e.gross ?? 0,
        platform_commission: e.commission ?? 0,
        net_earnings: e.net ?? 0,
        released_in_period: e.released ?? 0,
        pending_in_period: e.pending ?? 0,
        wallet_available_balance: (wallet as any)?.balance ?? 0,
        wallet_pending_balance: (wallet as any)?.pending_balance ?? 0,
      },
    };
  }

  private async walletLedger(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const rows = await this.transactionModel.aggregate([
      {
        $match: { createdAt: { $gte: range.start, $lt: range.end } },
      },
      {
        $lookup: {
          from: 'wallets',
          localField: 'wallet',
          foreignField: '_id',
          as: 'w',
        },
      },
      { $unwind: { path: '$w', preserveNullAndEmptyArrays: true } },
      { $match: { 'w.business': bid } },
      {
        $group: {
          _id: '$type',
          total: { $sum: { $ifNull: ['$amount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]);
    const byType: Record<string, { total: number; count: number }> = {};
    for (const r of rows) byType[r._id ?? 'unknown'] = {
      total: r.total,
      count: r.count,
    };
    return {
      ...this.meta(range),
      data: {
        credit: byType.credit ?? { total: 0, count: 0 },
        debit: byType.debit ?? { total: 0, count: 0 },
        fund: byType.fund ?? { total: 0, count: 0 },
        refund: byType.refund ?? { total: 0, count: 0 },
      },
    };
  }

  private async payoutForecast(bid: Types.ObjectId) {
    const [wallet, scheduled, unscheduledAgg] = await Promise.all([
      this.walletModel.findOne({ business: bid }).lean(),
      this.earningModel
        .find({
          business: bid,
          released: false,
          release_date: { $ne: null },
          net_amount: { $gt: 0 },
        })
        .select('net_amount release_date milestone')
        .sort({ release_date: 1 })
        .lean(),
      this.earningModel.aggregate([
        {
          $match: {
            business: bid,
            released: false,
            release_date: null,
            net_amount: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: '$net_amount' } } },
      ]),
    ]);

    const scheduledTotal = (scheduled as any[]).reduce(
      (s, e) => s + (e.net_amount || 0),
      0,
    );
    const next = (scheduled as any[])[0];
    return {
      currency: 'NGN',
      data: {
        available_now: (wallet as any)?.balance ?? 0,
        pending_scheduled_total: scheduledTotal,
        pending_unscheduled_total: unscheduledAgg[0]?.total ?? 0,
        next_release: next
          ? {
              date: new Date(next.release_date).toISOString(),
              amount: next.net_amount,
              milestone: next.milestone,
            }
          : null,
        upcoming_releases: (scheduled as any[]).slice(0, 5).map((e) => ({
          date: new Date(e.release_date).toISOString(),
          amount: e.net_amount,
          milestone: e.milestone,
        })),
      },
    };
  }
}
