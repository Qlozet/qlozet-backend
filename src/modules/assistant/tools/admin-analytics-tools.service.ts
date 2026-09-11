import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PERIOD_ENUM, resolveRange, type RangeArgs } from './date-range';

// Orders that represent real, paid sales (matches the vendor toolset).
const REVENUE_STATUSES = ['in_review', 'processing', 'in_transit', 'completed'];

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
 * Permission modules (ums Permission.module) gating each tool. `null` on a
 * tool = baseline, every platform user gets it. An admin with NO role at all
 * is treated as a super admin (sees everything) — the role system is opt-in.
 */
const TOOL_MODULES: Record<string, string[] | null> = {
  get_platform_summary: null,
  get_customer_growth: null,
  render_chart: null,
  get_orders_overview: ['order_management', 'analytics'],
  get_revenue_breakdown: ['financial_management', 'analytics'],
  get_payout_liabilities: ['financial_management'],
  get_token_economy: ['financial_management', 'analytics'],
  get_vendor_leaderboard: ['vendor_management', 'analytics'],
  get_vendor_stats: ['vendor_management', 'analytics'],
  get_moderation_queue: ['vendor_management', 'product_management'],
  get_support_overview: ['support_management'],
};

export function allowedToolNames(
  allowedModules: Set<string> | null,
): Set<string> | null {
  if (allowedModules === null) return null; // super admin — everything
  const names = new Set<string>();
  for (const [tool, mods] of Object.entries(TOOL_MODULES)) {
    if (mods === null || mods.some((m) => allowedModules.has(m))) {
      names.add(tool);
    }
  }
  return names;
}

/**
 * Read-only, PLATFORM-WIDE analytics tools for the admin assistant. No
 * business scoping — these aggregate across the whole marketplace. The
 * caller filters the tool list by the admin's role permissions BEFORE the
 * model ever sees it, so a support agent's model literally has no finance
 * tools to call.
 */
@Injectable()
export class AdminAnalyticsToolsService {
  private readonly logger = new Logger(AdminAnalyticsToolsService.name);

  constructor(
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('User') private readonly userModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
    @InjectModel('Product') private readonly productModel: Model<any>,
    @InjectModel('Ticket') private readonly ticketModel: Model<any>,
    @InjectModel('Dispute') private readonly disputeModel: Model<any>,
    @InjectModel('BusinessEarning')
    private readonly earningModel: Model<any>,
    @InjectModel('Wallet') private readonly walletModel: Model<any>,
    @InjectModel('TokenTransaction')
    private readonly tokenTxModel: Model<any>,
  ) {}

  getToolDefs(allowed: Set<string> | null): any[] {
    const defs = [
      {
        name: 'get_platform_summary',
        description:
          'Marketplace topline for a period: GMV (paid order value), paid order count, average order value, new customers, new vendor registrations.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_customer_growth',
        description:
          'Customer acquisition for a period: new customer signups, total customers to date, and signups for the prior equal-length period for comparison.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_orders_overview',
        description:
          'Order pipeline for a period: counts by status, split by order type (standard/bespoke/reservation), cancellations.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_revenue_breakdown',
        description:
          'Platform revenue for a period from recorded earnings: gross sales routed through vendors, platform commission earned, vendor net.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_payout_liabilities',
        description:
          'What the platform currently owes vendors: unreleased (held) earnings, wallet available balances, wallet pending balances. A snapshot — no period.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'get_token_economy',
        description:
          'Token flows for a period: tokens purchased, earned (rewards), spent on AI features, expired.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_vendor_leaderboard',
        description:
          'Top vendors by paid revenue (or order count) for a period, with revenue, order count and vendor name.',
        input_schema: {
          type: 'object',
          properties: {
            ...RANGE_PROPS,
            metric: {
              type: 'string',
              enum: ['revenue', 'orders'],
              description: 'Ranking metric. Defaults to revenue.',
            },
            limit: {
              type: 'number',
              description: 'How many vendors (1-20, default 10).',
            },
          },
        },
      },
      {
        name: 'get_vendor_stats',
        description:
          "One vendor's performance for a period: revenue, orders, open disputes, support tickets. Accepts a business id or a (partial) business name.",
        input_schema: {
          type: 'object',
          properties: {
            ...RANGE_PROPS,
            vendor: {
              type: 'string',
              description: 'Business id, or part of the business name.',
            },
          },
          required: ['vendor'],
        },
      },
      {
        name: 'get_moderation_queue',
        description:
          'What is waiting on admin action right now: products pending review and vendor applications awaiting approval (counts + oldest waiting days). A snapshot — no period.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'get_support_overview',
        description:
          'Support workload: tickets by status, unassigned open tickets, tickets opened in the period, disputes open/under review and opened in the period.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'render_chart',
        description:
          'Render a chart in the admin console UI from numbers ANOTHER tool returned. Call alongside your text when a comparison or trend is clearer visually. Never invent data points.',
        input_schema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['bar', 'line', 'pie'] },
            title: { type: 'string' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'number' },
                },
                required: ['label', 'value'],
              },
            },
          },
          required: ['type', 'title', 'data'],
        },
      },
    ];
    if (allowed === null) return defs;
    return defs.filter((d) => allowed.has(d.name));
  }

  async execute(
    name: string,
    args: any,
    allowed: Set<string> | null,
  ): Promise<any> {
    // Defense in depth: even if the model hallucinates a tool it wasn't
    // given, the executor refuses it.
    if (allowed !== null && !allowed.has(name)) {
      return { error: 'This tool is not available for your role.' };
    }
    try {
      switch (name) {
        case 'get_platform_summary':
          return await this.platformSummary(args);
        case 'get_customer_growth':
          return await this.customerGrowth(args);
        case 'get_orders_overview':
          return await this.ordersOverview(args);
        case 'get_revenue_breakdown':
          return await this.revenueBreakdown(args);
        case 'get_payout_liabilities':
          return await this.payoutLiabilities();
        case 'get_token_economy':
          return await this.tokenEconomy(args);
        case 'get_vendor_leaderboard':
          return await this.vendorLeaderboard(args);
        case 'get_vendor_stats':
          return await this.vendorStats(args);
        case 'get_moderation_queue':
          return await this.moderationQueue();
        case 'get_support_overview':
          return await this.supportOverview(args);
        default:
          return { error: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      this.logger.error(`Admin tool ${name} failed: ${err?.message}`);
      return { error: 'The data query failed. Try a narrower question.' };
    }
  }

  // ── Individual tools ─────────────────────────────────────────────

  private paidMatch(range: { start: Date; end: Date }) {
    return {
      createdAt: { $gte: range.start, $lt: range.end },
      $or: [
        { payment_status: 'paid' },
        { status: { $in: REVENUE_STATUSES } },
      ],
    };
  }

  private async platformSummary(args: RangeArgs) {
    const range = resolveRange(args ?? {});
    const [orders, newCustomers, newVendors] = await Promise.all([
      this.orderModel.aggregate([
        { $match: this.paidMatch(range) },
        {
          $group: {
            _id: null,
            gmv: { $sum: { $ifNull: ['$total', 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
      this.userModel.countDocuments({
        type: 'customer',
        createdAt: { $gte: range.start, $lt: range.end },
      }),
      this.businessModel.countDocuments({
        createdAt: { $gte: range.start, $lt: range.end },
      }),
    ]);
    const o = orders[0] ?? { gmv: 0, count: 0 };
    return {
      period: range.label,
      gmv_ngn: Math.round(o.gmv),
      paid_orders: o.count,
      average_order_value_ngn: o.count ? Math.round(o.gmv / o.count) : 0,
      new_customers: newCustomers,
      new_vendor_registrations: newVendors,
    };
  }

  private async customerGrowth(args: RangeArgs) {
    const range = resolveRange(args ?? {});
    const spanMs = range.end.getTime() - range.start.getTime();
    const prevStart = new Date(range.start.getTime() - spanMs);
    const [current, previous, total] = await Promise.all([
      this.userModel.countDocuments({
        type: 'customer',
        createdAt: { $gte: range.start, $lt: range.end },
      }),
      this.userModel.countDocuments({
        type: 'customer',
        createdAt: { $gte: prevStart, $lt: range.start },
      }),
      this.userModel.countDocuments({ type: 'customer' }),
    ]);
    return {
      period: range.label,
      new_customers: current,
      previous_period_new_customers: previous,
      total_customers: total,
    };
  }

  private async ordersOverview(args: RangeArgs) {
    const range = resolveRange(args ?? {});
    const inRange = { createdAt: { $gte: range.start, $lt: range.end } };
    const [byStatus, byType] = await Promise.all([
      this.orderModel.aggregate([
        { $match: inRange },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate([
        { $match: inRange },
        { $group: { _id: { $ifNull: ['$type', 'standard'] }, count: { $sum: 1 } } },
      ]),
    ]);
    return {
      period: range.label,
      by_status: byStatus.map((r) => ({ status: r._id, count: r.count })),
      by_type: byType.map((r) => ({ type: r._id, count: r.count })),
    };
  }

  private async revenueBreakdown(args: RangeArgs) {
    const range = resolveRange(args ?? {});
    const rows = await this.earningModel.aggregate([
      { $match: { createdAt: { $gte: range.start, $lt: range.end } } },
      {
        $group: {
          _id: null,
          gross: { $sum: { $ifNull: ['$amount', 0] } },
          commission: { $sum: { $ifNull: ['$commission', 0] } },
          vendor_net: { $sum: { $ifNull: ['$net_amount', 0] } },
          records: { $sum: 1 },
        },
      },
    ]);
    const r = rows[0] ?? { gross: 0, commission: 0, vendor_net: 0, records: 0 };
    return {
      period: range.label,
      note: 'From recorded vendor earnings (paid orders only).',
      gross_sales_ngn: Math.round(r.gross),
      platform_commission_ngn: Math.round(r.commission),
      vendor_net_ngn: Math.round(r.vendor_net),
      earning_records: r.records,
    };
  }

  private async payoutLiabilities() {
    const [held, wallets] = await Promise.all([
      this.earningModel.aggregate([
        { $match: { released: false } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$net_amount', 0] } }, count: { $sum: 1 } } },
      ]),
      this.walletModel.aggregate([
        {
          $group: {
            _id: null,
            available: { $sum: { $ifNull: ['$balance', 0] } },
            pending: { $sum: { $ifNull: ['$pending_balance', 0] } },
            wallets: { $sum: 1 },
          },
        },
      ]),
    ]);
    const h = held[0] ?? { total: 0, count: 0 };
    const w = wallets[0] ?? { available: 0, pending: 0, wallets: 0 };
    return {
      snapshot: new Date().toISOString().slice(0, 10),
      unreleased_earnings_ngn: Math.round(h.total),
      unreleased_earning_records: h.count,
      wallet_available_balance_ngn: Math.round(w.available),
      wallet_pending_balance_ngn: Math.round(w.pending),
      wallets: w.wallets,
    };
  }

  private async tokenEconomy(args: RangeArgs) {
    const range = resolveRange(args ?? {});
    const rows = await this.tokenTxModel.aggregate([
      { $match: { createdAt: { $gte: range.start, $lt: range.end } } },
      {
        $group: {
          _id: '$type',
          tokens: { $sum: { $ifNull: ['$amount', 0] } },
          transactions: { $sum: 1 },
        },
      },
    ]);
    return {
      period: range.label,
      by_type: rows.map((r) => ({
        type: r._id,
        tokens: r.tokens,
        transactions: r.transactions,
      })),
    };
  }

  private async vendorLeaderboard(args: any) {
    const range = resolveRange(args ?? {});
    const metric = args?.metric === 'orders' ? 'orders' : 'revenue';
    const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 20);
    const rows = await this.orderModel.aggregate([
      { $match: this.paidMatch(range) },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.business',
          revenue: { $sum: { $ifNull: ['$items.total_price', 0] } },
          orders: { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          revenue: 1,
          orders: { $size: '$orders' },
        },
      },
      { $sort: metric === 'orders' ? { orders: -1 } : { revenue: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'businesses',
          localField: '_id',
          foreignField: '_id',
          as: 'biz',
        },
      },
      {
        $project: {
          business_id: '$_id',
          name: { $ifNull: [{ $arrayElemAt: ['$biz.business_name', 0] }, 'Unknown'] },
          revenue_ngn: { $round: ['$revenue', 0] },
          orders: 1,
        },
      },
    ]);
    return { period: range.label, metric, vendors: rows };
  }

  private async vendorStats(args: any) {
    const range = resolveRange(args ?? {});
    const q = String(args?.vendor ?? '').trim();
    if (!q) return { error: 'vendor is required (id or name).' };

    const business = Types.ObjectId.isValid(q)
      ? await this.businessModel.findById(q).select('business_name status')
      : await this.businessModel
          .findOne({ business_name: { $regex: q, $options: 'i' } })
          .select('business_name status');
    if (!business) return { error: `No vendor matching "${q}".` };
    const bid = business._id;

    const [sales, disputes, tickets] = await Promise.all([
      this.orderModel.aggregate([
        { $match: this.paidMatch(range) },
        { $unwind: '$items' },
        { $match: { 'items.business': bid } },
        {
          $group: {
            _id: null,
            revenue: { $sum: { $ifNull: ['$items.total_price', 0] } },
            orders: { $addToSet: '$_id' },
          },
        },
      ]),
      this.disputeModel.countDocuments({
        business: bid,
        status: { $in: ['open', 'under_review'] },
      }),
      this.ticketModel.countDocuments({
        business: bid,
        createdAt: { $gte: range.start, $lt: range.end },
      }),
    ]);
    const s = sales[0] ?? { revenue: 0, orders: [] };
    return {
      period: range.label,
      vendor: business.business_name,
      vendor_status: business.status,
      revenue_ngn: Math.round(s.revenue),
      paid_orders: Array.isArray(s.orders) ? s.orders.length : 0,
      open_disputes: disputes,
      tickets_opened_in_period: tickets,
    };
  }

  private async moderationQueue() {
    const [pendingProducts, oldestProduct, pendingVendors, oldestVendor] =
      await Promise.all([
        this.productModel.countDocuments({
          $or: [
            { 'moderation.status': 'pending' },
            { moderation: { $exists: false } },
          ],
        }),
        this.productModel
          .findOne({
            $or: [
              { 'moderation.status': 'pending' },
              { moderation: { $exists: false } },
            ],
          })
          .sort({ createdAt: 1 })
          .select('createdAt'),
        this.businessModel.countDocuments({
          status: { $nin: ['approved', 'verified'] },
        }),
        this.businessModel
          .findOne({ status: { $nin: ['approved', 'verified'] } })
          .sort({ createdAt: 1 })
          .select('createdAt business_name'),
      ]);
    const days = (d?: Date) =>
      d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
    return {
      snapshot: new Date().toISOString().slice(0, 10),
      products_pending_review: pendingProducts,
      oldest_pending_product_days: days((oldestProduct as any)?.createdAt),
      vendor_applications_pending: pendingVendors,
      oldest_pending_vendor_days: days((oldestVendor as any)?.createdAt),
      oldest_pending_vendor: (oldestVendor as any)?.business_name ?? null,
    };
  }

  private async supportOverview(args: RangeArgs) {
    const range = resolveRange(args ?? {});
    const [byStatus, unassigned, openedInPeriod, disputesByStatus, disputesOpened] =
      await Promise.all([
        this.ticketModel.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.ticketModel.countDocuments({
          status: { $in: ['open', 'in_progress'] },
          $or: [{ assigned_to: null }, { assigned_to: { $exists: false } }],
        }),
        this.ticketModel.countDocuments({
          createdAt: { $gte: range.start, $lt: range.end },
        }),
        this.disputeModel.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.disputeModel.countDocuments({
          createdAt: { $gte: range.start, $lt: range.end },
        }),
      ]);
    return {
      period: range.label,
      tickets_by_status: byStatus.map((r) => ({ status: r._id, count: r.count })),
      unassigned_active_tickets: unassigned,
      tickets_opened_in_period: openedInPeriod,
      disputes_by_status: disputesByStatus.map((r) => ({
        status: r._id,
        count: r.count,
      })),
      disputes_opened_in_period: disputesOpened,
    };
  }
}
