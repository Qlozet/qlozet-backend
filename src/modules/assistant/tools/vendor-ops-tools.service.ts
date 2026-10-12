import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LlmToolDef } from '../llm/llm-provider.interface';
import { PERIOD_ENUM, RangeArgs, ResolvedRange, resolveRange } from './date-range';
import {
  CATALOGUE_ISSUE_LABEL,
  catalogueIssues,
  describeOrder,
  fulfilmentStats,
  quoteStats,
  reviewStats,
  vendorShipment,
} from './vendor-ops.helpers';
import { productFacts } from '../../recommendations/catalog/product-facts';
import { escapeRegex, pickByName, productName } from '../actions/vendor-actions.helpers';

const RANGE_PROPS = {
  period: {
    type: 'string',
    enum: [...PERIOD_ENUM],
    description: 'Preset time window. Ignored when start_date is given.',
  },
  start_date: { type: 'string', description: 'Custom range start (YYYY-MM-DD). Overrides period.' },
  end_date: { type: 'string', description: 'Custom range end (YYYY-MM-DD). Defaults to today.' },
};

const ORDER_VIEWS = [
  'needs_action',
  'awaiting_confirmation',
  'awaiting_shipment',
  'overdue',
  'in_transit',
  'completed',
  'cancelled',
  'returned',
  'all',
] as const;

const DELIVERED_STATUSES = ['in_transit', 'completed', 'returned'];

/**
 * Read-only operations tools for the vendor assistant: what is waiting on the
 * vendor, how fast they fulfil, what comes back and why, what customers say,
 * the bespoke quote funnel, and what their listings are missing.
 *
 * Same contract as AnalyticsToolsService: every method takes the authenticated
 * businessId from the caller (never from the model) and hard-filters on it.
 */
@Injectable()
export class VendorOpsToolsService {
  private readonly logger = new Logger(VendorOpsToolsService.name);

  constructor(
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('Product') private readonly productModel: Model<any>,
    @InjectModel('Return') private readonly returnModel: Model<any>,
    @InjectModel('Dispute') private readonly disputeModel: Model<any>,
    @InjectModel('BespokeQuote') private readonly quoteModel: Model<any>,
    @InjectModel('Event') private readonly eventModel: Model<any>,
    @InjectModel('SystemCategory') private readonly categoryModel: Model<any>,
  ) {}

  getToolDefs(): LlmToolDef[] {
    return [
      {
        name: 'get_orders',
        description:
          "The vendor's orders from THEIR side: what is waiting on them (unconfirmed, confirmed but not shipped, bespoke changes requested), what is overdue against its fulfilment deadline, and counts by stage. Default view is needs_action. Terminal views (completed/cancelled/returned) use the period.",
        input_schema: {
          type: 'object',
          properties: {
            view: { type: 'string', enum: [...ORDER_VIEWS], description: 'Which orders to list. Default needs_action.' },
            limit: { type: 'number', description: 'Max orders to list (default 10, max 25).' },
            ...RANGE_PROPS,
          },
        },
      },
      {
        name: 'get_fulfilment_speed',
        description:
          "How fast and reliably the vendor fulfils over the period: hours to confirm, days to ship, days in transit, late shipments and on-time rate, orders still open past deadline, late penalties - with the platform average for comparison. Slow confirmation and late shipping lower the vendor's success rate, which lowers their ranking.",
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_returns_and_disputes',
        description:
          "Returns and disputes on the vendor's orders for the period: counts by status and reason, the products returned most and why, return rate against delivered orders, open disputes that still need the vendor's response, and refund totals.",
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_reviews',
        description:
          "Customer ratings across the vendor's products (all time - ratings carry no dates): average and distribution, the lowest and highest rated products, the latest low-rating comments to read, and the platform average rating for comparison.",
        input_schema: {
          type: 'object',
          properties: {
            product: { type: 'string', description: 'Optional product name (or part of it) to focus on.' },
          },
        },
      },
      {
        name: 'get_bespoke_pipeline',
        description:
          'The bespoke (custom tailoring) funnel for a tailor: quote requests waiting for a reply and how long they have waited, quotes awaiting the customer, win rate, average quoted and accepted prices, promised completion days, response time, and bespoke orders in production with their deadlines. Defaults to the last 90 days.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS } },
      },
      {
        name: 'get_product_listing',
        description:
          "One product's full listing as shoppers and search see it - description, product type, categories, attributes, audience, colours, sizes, images, price, size guide - with its issues, AND the allowed product types, categories and attributes for it. Call this before drafting or fixing a listing; taxonomy values in update_listing must come from these allowed lists.",
        input_schema: {
          type: 'object',
          required: ['product'],
          properties: { product: { type: 'string', description: 'The product name (or part of it).' } },
        },
      },
      {
        name: 'get_catalogue_health',
        description:
          "What is missing from the vendor's product listings - photos, descriptions, audience, colours, sizes, size guide, price - plus stale drafts, sold-out items and active products nobody viewed in 30 days. These are the fields search, the home page and the AI stylist filter on, so a gap means the product is not shown to shoppers.",
        input_schema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max products to list (default 15, max 40).' },
          },
        },
      },
    ];
  }

  handles(name: string): boolean {
    return this.getToolDefs().some((t) => t.name === name);
  }

  async execute(name: string, businessId: string, args: any): Promise<any> {
    const bid = new Types.ObjectId(businessId);
    const a = args ?? {};
    switch (name) {
      case 'get_orders':
        return this.orders(bid, a);
      case 'get_fulfilment_speed':
        return this.fulfilmentSpeed(bid, a);
      case 'get_returns_and_disputes':
        return this.returnsAndDisputes(bid, a);
      case 'get_reviews':
        return this.reviews(bid, a);
      case 'get_bespoke_pipeline':
        return this.bespokePipeline(bid, a);
      case 'get_catalogue_health':
        return this.catalogueHealth(bid, a);
      case 'get_product_listing':
        return this.productListing(bid, a);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private meta(range: ResolvedRange, extra: Record<string, any> = {}) {
    return {
      period: range.label,
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      currency: 'NGN',
      ...extra,
    };
  }

  private clamp(n: any, def: number, max: number): number {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : def;
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  private async orders(bid: Types.ObjectId, args: any) {
    const view = (ORDER_VIEWS as readonly string[]).includes(args.view) ? args.view : 'needs_action';
    const limit = this.clamp(args.limit, 10, 25);
    const now = new Date();
    const select =
      'reference status order_type createdAt items.business items.total_price items.rejected ' +
      'shipments preship.status fulfillment_deadline';

    // Open orders: everything the vendor may still owe something on.
    const open = await this.orderModel
      .find({ 'items.business': bid, status: { $in: ['in_review', 'processing', 'in_transit'] } })
      .select(select)
      .sort({ createdAt: 1 })
      .lean();
    const openRows = (open as any[]).map((o) => describeOrder(o, bid, now));

    const byStage: Record<string, number> = {};
    for (const r of openRows) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;

    let rows = openRows;
    let periodMeta: Record<string, any> = {};
    if (view === 'needs_action') rows = openRows.filter((r) => r.needs_action);
    else if (view === 'awaiting_confirmation') rows = openRows.filter((r) => r.stage === 'awaiting_confirmation');
    else if (view === 'awaiting_shipment') rows = openRows.filter((r) => r.stage === 'awaiting_your_shipment' || r.stage === 'preship_changes_requested');
    else if (view === 'overdue') rows = openRows.filter((r) => r.overdue);
    else if (view === 'in_transit') rows = openRows.filter((r) => r.stage === 'shipped' || r.stage === 'delivered');
    else if (view === 'completed' || view === 'cancelled' || view === 'returned' || view === 'all') {
      const range = resolveRange(args as RangeArgs);
      periodMeta = this.meta(range);
      const statusFilter = view === 'all' ? {} : { status: view };
      const past = await this.orderModel
        .find({ 'items.business': bid, createdAt: { $gte: range.start, $lt: range.end }, ...statusFilter })
        .select(select)
        .sort({ createdAt: -1 })
        .lean();
      rows = (past as any[]).map((o) => describeOrder(o, bid, now));
    }

    // Overdue first, then oldest first - the order of attention.
    rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.age_hours ?? 0) - (a.age_hours ?? 0));

    return {
      currency: 'NGN',
      ...periodMeta,
      data: {
        view,
        open_orders: openRows.length,
        needs_action: openRows.filter((r) => r.needs_action).length,
        overdue: openRows.filter((r) => r.overdue).length,
        by_stage: byStage,
        listed: rows.length,
        orders: rows.slice(0, limit),
        note: 'Stages are from this vendor\'s side of each order. "awaiting_confirmation" and "awaiting_your_shipment" are the vendor\'s move; "preship_awaiting_customer" is the customer\'s.',
      },
    };
  }

  // ── Fulfilment speed ──────────────────────────────────────────────────────

  private async fulfilmentSpeed(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const now = new Date();
    const mine = await this.orderModel
      .find({
        'shipments.business': bid,
        createdAt: { $gte: range.start, $lt: range.end },
        status: { $nin: ['pending'] },
      })
      .select('status createdAt shipments fulfillment_deadline late_penalty_applied late_penalty_amount')
      .lean();
    const stats = fulfilmentStats(mine as any[], bid, now);

    // Platform average over the same window, anonymised - one aggregate, no names.
    let platform: { avg_hours_to_confirm: number | null; avg_days_to_ship: number | null } = {
      avg_hours_to_confirm: null,
      avg_days_to_ship: null,
    };
    try {
      const agg = await this.orderModel.aggregate([
        { $match: { createdAt: { $gte: range.start, $lt: range.end }, status: { $nin: ['pending'] } } },
        { $unwind: '$shipments' },
        {
          $project: {
            confirmH: {
              $cond: [
                { $ifNull: ['$shipments.confirmed_at', false] },
                { $divide: [{ $subtract: ['$shipments.confirmed_at', '$createdAt'] }, 3600000] },
                null,
              ],
            },
            shipD: {
              $cond: [
                { $and: [{ $ifNull: ['$shipments.shipped_at', false] }, { $ifNull: ['$shipments.confirmed_at', false] }] },
                { $divide: [{ $subtract: ['$shipments.shipped_at', '$shipments.confirmed_at'] }, 86400000] },
                null,
              ],
            },
          },
        },
        { $group: { _id: null, confirmH: { $avg: '$confirmH' }, shipD: { $avg: '$shipD' } } },
      ]);
      const r = agg[0];
      if (r) {
        platform = {
          avg_hours_to_confirm: r.confirmH != null ? Math.round(r.confirmH * 10) / 10 : null,
          avg_days_to_ship: r.shipD != null ? Math.round(r.shipD * 10) / 10 : null,
        };
      }
    } catch (err: any) {
      this.logger.warn(`Platform fulfilment average failed: ${err?.message}`);
    }

    return {
      ...this.meta(range),
      data: {
        ...stats,
        platform_average: platform,
        note: 'Confirmation and shipping times feed the success rate that ranks the store; late shipments can carry a penalty.',
      },
    };
  }

  // ── Returns & disputes ────────────────────────────────────────────────────

  private async returnsAndDisputes(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange(args);
    const now = new Date();
    const window = { createdAt: { $gte: range.start, $lt: range.end } };

    const [returns, disputes, delivered] = await Promise.all([
      this.returnModel.find({ business: bid, ...window }).select('order status reason items refund_amount createdAt').lean(),
      this.disputeModel
        .find({ business: bid, ...window })
        .select('order_reference status reason initiated_by vendor_response refund_amount createdAt resolved_at')
        .lean(),
      this.orderModel.countDocuments({ 'items.business': bid, status: { $in: DELIVERED_STATUSES }, ...window }),
    ]);

    // Which products came back: return.items are order-item ids, resolved
    // through their orders to products, then to names.
    const orderIds = [...new Set((returns as any[]).map((r) => String(r.order)).filter(Boolean))];
    const itemToProduct = new Map<string, string>();
    if (orderIds.length) {
      const orders = await this.orderModel
        .find({ _id: { $in: orderIds.map((id) => new Types.ObjectId(id)) } })
        .select('items._id items.product')
        .lean();
      for (const o of orders as any[]) for (const it of o.items || []) if (it?.product) itemToProduct.set(String(it._id), String(it.product));
    }
    const perProduct = new Map<string, { count: number; reasons: Record<string, number> }>();
    for (const r of returns as any[]) {
      const products = new Set((r.items || []).map((id: any) => itemToProduct.get(String(id))).filter(Boolean) as string[]);
      for (const pid of products) {
        const row = perProduct.get(pid) ?? { count: 0, reasons: {} };
        row.count++;
        row.reasons[r.reason] = (row.reasons[r.reason] ?? 0) + 1;
        perProduct.set(pid, row);
      }
    }
    const names = new Map<string, string>();
    if (perProduct.size) {
      const prods = await this.productModel
        .find({ _id: { $in: [...perProduct.keys()].map((id) => new Types.ObjectId(id)) } })
        .select('clothing.name fabric.name accessory.name')
        .lean();
      for (const p of prods as any[]) names.set(String(p._id), p.clothing?.name || p.fabric?.name || p.accessory?.name || 'Unnamed product');
    }
    const mostReturned = [...perProduct.entries()]
      .map(([pid, v]) => ({ product: names.get(pid) ?? 'Unknown product', returns: v.count, reasons: v.reasons }))
      .sort((a, b) => b.returns - a.returns)
      .slice(0, 8);

    const count = (rows: any[], key: string) =>
      rows.reduce((acc: Record<string, number>, r) => { const k = String(r[key] ?? 'unknown'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

    const refunded = (returns as any[])
      .filter((r) => r.status === 'refund_processed')
      .reduce((s, r) => s + (Number(r.refund_amount) || 0), 0);
    const openDisputes = (disputes as any[])
      .filter((d) => d.status === 'open' || d.status === 'under_review')
      .map((d) => ({
        order: d.order_reference,
        reason: d.reason,
        raised_by: d.initiated_by ?? 'customer',
        status: d.status,
        age_hours: Math.round(((now.getTime() - new Date(d.createdAt).getTime()) / 3600000) * 10) / 10,
        awaiting_your_response: !d.vendor_response && d.initiated_by !== 'vendor',
      }))
      .sort((a, b) => Number(b.awaiting_your_response) - Number(a.awaiting_your_response) || b.age_hours - a.age_hours);
    const disputeRefunds = (disputes as any[])
      .filter((d) => String(d.status).startsWith('resolved_') && d.status !== 'resolved_released')
      .reduce((s, d) => s + (Number(d.refund_amount) || 0), 0);

    return {
      ...this.meta(range),
      data: {
        returns: {
          total: returns.length,
          awaiting_your_decision: (returns as any[]).filter((r) => r.status === 'requested').length,
          by_status: count(returns as any[], 'status'),
          by_reason: count(returns as any[], 'reason'),
          most_returned_products: mostReturned,
          refunded_amount: refunded,
          delivered_orders: delivered,
          return_rate: delivered ? `${Math.round((returns.length / delivered) * 1000) / 10}%` : null,
        },
        disputes: {
          total: disputes.length,
          open: openDisputes.length,
          awaiting_your_response: openDisputes.filter((d) => d.awaiting_your_response).length,
          by_status: count(disputes as any[], 'status'),
          by_reason: count(disputes as any[], 'reason'),
          open_list: openDisputes.slice(0, 10),
          refunded_through_disputes: disputeRefunds,
        },
      },
    };
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  private async reviews(bid: Types.ObjectId, args: any) {
    const products = await this.productModel
      .find({ business: bid, status: { $ne: 'archived' }, 'ratings.0': { $exists: true } })
      .select('kind clothing.name fabric.name accessory.name ratings')
      .lean();
    let rows = (products as any[]).map((p) => ({
      name: p.clothing?.name || p.fabric?.name || p.accessory?.name || 'Unnamed product',
      ratings: p.ratings || [],
    }));
    const focus = String(args.product ?? '').trim().toLowerCase();
    if (focus) rows = rows.filter((r) => r.name.toLowerCase().includes(focus));

    const stats = reviewStats(rows);

    let platformAverage: number | null = null;
    try {
      const agg = await this.productModel.aggregate([
        { $match: { status: 'active', total_ratings: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$average_rating' } } },
      ]);
      if (agg[0]?.avg != null) platformAverage = Math.round(agg[0].avg * 10) / 10;
    } catch (err: any) {
      this.logger.warn(`Platform rating average failed: ${err?.message}`);
    }

    return {
      currency: 'NGN',
      data: {
        focus: focus || null,
        ...stats,
        platform_average_rating: platformAverage,
        note: 'Ratings have no timestamps, so "recent" means the latest left, not a time window.',
      },
    };
  }

  // ── Bespoke pipeline ──────────────────────────────────────────────────────

  private async bespokePipeline(bid: Types.ObjectId, args: RangeArgs) {
    const range = resolveRange({ period: 'last_90_days', ...args });
    const now = new Date();
    const [quotes, inProduction] = await Promise.all([
      this.quoteModel
        .find({ vendor: bid, createdAt: { $gte: range.start, $lt: range.end } })
        .select('reference status total estimated_completion_days createdAt submitted_at accepted_at expires_at design')
        .populate({ path: 'design', select: 'name category' })
        .lean(),
      this.orderModel
        .find({ order_type: 'bespoke', 'items.business': bid, status: { $in: ['in_review', 'processing'] } })
        .select('reference status order_type createdAt items.business items.total_price items.rejected shipments preship.status fulfillment_deadline')
        .lean(),
    ]);

    const stats = quoteStats(quotes as any[], now);
    const production = (inProduction as any[])
      .filter((o) => vendorShipment(o, bid))
      .map((o) => describeOrder(o, bid, now))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.hours_to_deadline ?? Infinity) - (b.hours_to_deadline ?? Infinity));

    return {
      ...this.meta(range),
      data: {
        quotes: stats,
        in_production: {
          count: production.length,
          overdue: production.filter((p) => p.overdue).length,
          awaiting_customer_preship_review: production.filter((p) => p.stage === 'preship_awaiting_customer').length,
          changes_requested: production.filter((p) => p.stage === 'preship_changes_requested').length,
          orders: production.slice(0, 10),
        },
        note: 'Quote requests are counted from when the customer asked; a request waiting more than a day is usually lost to another tailor.',
      },
    };
  }

  // ── One listing ───────────────────────────────────────────────────────────

  private async productListing(bid: Types.ObjectId, args: any) {
    const typed = String(args.product ?? '').trim();
    if (!typed) return { error: 'Give product (its name).' };
    const rx = new RegExp(escapeRegex(typed), 'i');
    const candidates = await this.productModel
      .find({ business: bid, status: { $ne: 'archived' }, $or: [{ 'clothing.name': rx }, { 'fabric.name': rx }, { 'accessory.name': rx }] })
      .select('kind status base_price discounted_price size_guide createdAt average_rating total_ratings clothing fabric accessory')
      .lean();
    const pick = pickByName(candidates as any[], typed, productName);
    if ('none' in pick) return { error: `No product named "${typed}".` };
    if ('ambiguous' in pick) return { error: `Several products match "${typed}": ${pick.ambiguous.join(', ')}. Which one?` };
    const p: any = pick.match;
    const sub = p[p.kind] ?? {};
    const tax = sub.taxonomy ?? {};
    const facts = productFacts(p);

    let allowed: { product_types: string[]; categories: string[] | null; attributes: string[] | null } = { product_types: [], categories: null, attributes: null };
    try {
      const [types, cat] = await Promise.all([
        this.categoryModel.find({ kind: p.kind, is_active: true }).select('product_type').lean(),
        tax.product_type ? this.categoryModel.findOne({ kind: p.kind, product_type: tax.product_type, is_active: true }).lean() : null,
      ]);
      allowed = {
        product_types: (types as any[]).map((t) => t.product_type).filter(Boolean),
        categories: cat ? (cat as any).categories ?? [] : null,
        attributes: cat ? (cat as any).attributes ?? [] : null,
      };
    } catch (err: any) {
      this.logger.warn(`Taxonomy lookup failed: ${err?.message}`);
    }

    const description = String(sub.description ?? '');
    return {
      currency: 'NGN',
      data: {
        name: productName(p),
        kind: p.kind,
        status: p.status,
        price: p.base_price,
        discounted_price: facts.discounted_price ?? null,
        price_per_yard: facts.price_per_yard ?? null,
        description,
        description_length: description.trim().length,
        taxonomy: {
          product_type: tax.product_type ?? null,
          categories: tax.categories ?? [],
          attributes: tax.attributes ?? [],
          audience: tax.audience ?? null,
        },
        colours: facts.colors,
        sizes: facts.sizes,
        in_stock: facts.in_stock ?? null,
        made_to_order: facts.made_to_order ?? false,
        turnaround_days: facts.turnaround_days ?? null,
        material: facts.material ?? null,
        pattern: facts.pattern ?? null,
        images: Array.isArray(sub.images) ? sub.images.length : 0,
        has_size_guide: !!p.size_guide,
        rating: facts.rating ?? null,
        rating_count: facts.rating_count ?? null,
        issues: catalogueIssues(p, new Date()).map((i) => CATALOGUE_ISSUE_LABEL[i] ?? i),
        allowed: {
          audiences: ['men', 'women', 'unisex', 'kids'],
          product_types: allowed.product_types,
          categories: allowed.categories,
          attributes: allowed.attributes,
          note: allowed.categories === null
            ? 'No vocabulary is defined for this product type yet, so categories and attributes are free text here.'
            : 'update_listing accepts only these categories and attributes.',
        },
      },
    };
  }

  // ── Catalogue health ──────────────────────────────────────────────────────

  private async catalogueHealth(bid: Types.ObjectId, args: any) {
    const limit = this.clamp(args.limit, 15, 40);
    const now = new Date();
    const products = await this.productModel
      .find({ business: bid, status: { $in: ['active', 'draft', 'scheduled'] } })
      .select('kind status base_price discounted_price size_guide createdAt clothing fabric accessory')
      .lean();

    // Views in the last 30 days, per product, from the events stream.
    const activeIds = (products as any[]).filter((p) => p.status === 'active').map((p) => String(p._id));
    const views = new Map<string, number>();
    if (activeIds.length) {
      try {
        const since = new Date(now.getTime() - 30 * 86400000);
        const agg = await this.eventModel.aggregate([
          { $match: { eventType: 'view_item', timestamp: { $gte: since }, 'properties.itemId': { $in: activeIds } } },
          { $group: { _id: '$properties.itemId', n: { $sum: 1 } } },
        ]);
        for (const r of agg) views.set(String(r._id), r.n);
      } catch (err: any) {
        this.logger.warn(`View counts unavailable: ${err?.message}`);
      }
    }

    const issueCounts: Record<string, number> = {};
    const rows: { product: string; kind: string; status: string; issues: string[]; views_30d: number | null }[] = [];
    let complete = 0;
    for (const p of products as any[]) {
      const id = String(p._id);
      const v = p.status === 'active' ? (views.get(id) ?? 0) : undefined;
      const issues = catalogueIssues(p, now, v);
      if (!issues.length) { complete++; continue; }
      for (const i of issues) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
      rows.push({
        product: p.clothing?.name || p.fabric?.name || p.accessory?.name || 'Unnamed product',
        kind: p.kind,
        status: p.status,
        issues: issues.map((i) => CATALOGUE_ISSUE_LABEL[i] ?? i),
        views_30d: v ?? null,
      });
    }
    // Most issues first; among equals, the ones nobody is seeing.
    rows.sort((a, b) => b.issues.length - a.issues.length || (a.views_30d ?? 0) - (b.views_30d ?? 0));

    return {
      currency: 'NGN',
      data: {
        products_checked: products.length,
        complete,
        with_issues: rows.length,
        issue_counts: Object.fromEntries(Object.entries(issueCounts).map(([k, n]) => [CATALOGUE_ISSUE_LABEL[k] ?? k, n])),
        products: rows.slice(0, limit),
        note: 'Audience, colours and sizes are what search filters and the AI stylist match on; a product missing them is rarely shown. Photos and a real description are what makes a shown product convert.',
      },
    };
  }
}
