import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LlmToolDef } from '../llm/llm-provider.interface';
import { PERIOD_ENUM, RangeArgs, resolveRange } from './date-range';
import { searchGaps, stuckOrdersFrom, vendorHealth, VendorHealthInput } from './admin-ops.helpers';
import { CATALOGUE_ISSUE_LABEL, catalogueIssues, describeOrder, vendorItems } from './vendor-ops.helpers';
import { escapeRegex, pickByName, productName } from '../actions/vendor-actions.helpers';
import { LedgerSums, TallyOrder, tallyVendorMoney } from '../../business/vendor-money-tally';
import { explainVendorMoney, MONEY_FIXES } from '../../business/vendor-money-explain';

const RANGE_PROPS = {
  period: { type: 'string', enum: [...PERIOD_ENUM], description: 'Preset time window. Defaults to this_month.' },
  start_date: { type: 'string', description: 'Custom range start (YYYY-MM-DD). Overrides period.' },
  end_date: { type: 'string', description: 'Custom range end (YYYY-MM-DD). Defaults to today.' },
};

/** Which admin tool's permission a work-queue section borrows. */
const QUEUE_GATES: Record<string, string> = {
  products_pending_review: 'get_moderation_queue',
  vendor_applications: 'get_moderation_queue',
  tickets: 'get_support_overview',
  disputes: 'get_support_overview',
  returns: 'get_orders_overview',
  payouts_due: 'get_payout_liabilities',
};

const OPEN_ORDER_STATUSES = ['in_review', 'processing', 'in_transit'];
const LOOKBACK_DAYS = 90;

/**
 * Operations tools for the admin assistant: what is waiting on the team, one
 * record in full, search, stuck orders and vendor health. Platform-wide and
 * read-only; the caller filters the tool list by the admin's permission
 * modules before the model sees it, and execute() refuses anything outside
 * that list.
 */
@Injectable()
export class AdminOpsToolsService {
  private readonly logger = new Logger(AdminOpsToolsService.name);

  constructor(
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('User') private readonly userModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
    @InjectModel('Product') private readonly productModel: Model<any>,
    @InjectModel('Ticket') private readonly ticketModel: Model<any>,
    @InjectModel('TicketReply') private readonly ticketReplyModel: Model<any>,
    @InjectModel('Dispute') private readonly disputeModel: Model<any>,
    @InjectModel('Return') private readonly returnModel: Model<any>,
    @InjectModel('BusinessEarning') private readonly earningModel: Model<any>,
    @InjectModel('Wallet') private readonly walletModel: Model<any>,
    @InjectModel('Transaction') private readonly transactionModel: Model<any>,
    @InjectModel('Event') private readonly eventModel: Model<any>,
    @InjectModel('TeamMember') private readonly teamMemberModel: Model<any>,
  ) {}

  getToolDefs(): LlmToolDef[] {
    return [
      {
        name: 'get_work_queue',
        description:
          'What is waiting on the admin team right now, as LISTS oldest-first (not counts): products pending review, vendor applications, unassigned or unanswered tickets, disputes awaiting a decision, returns stuck on the vendor or awaiting refund, payouts due. Sections outside your role are omitted. A snapshot - no period. Start here for "what needs attention".',
        input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max items per section (default 10, max 25).' } } },
      },
      {
        name: 'search',
        description:
          'Find the thing the admin is talking about: an order by reference, a vendor by name or email, a customer by name, email or phone, a product by name, a ticket or dispute by id. Returns up to five matches per kind with the id/reference to pass to get_order, get_vendor, get_customer, get_ticket or get_dispute.',
        input_schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
      },
      {
        name: 'get_order',
        description:
          'One order in full: customer, items with vendors, each vendor shipment (confirmed / shipped / delivered, deadline, courier, tracking), bespoke pre-ship state, payment, totals, and the disputes and returns raised on it. Takes the order reference.',
        input_schema: { type: 'object', required: ['reference'], properties: { reference: { type: 'string' } } },
      },
      {
        name: 'get_vendor',
        description:
          'One vendor in full: status and verification, profile, the team (who holds which role, accepted or not - this is who notifications and nudges reach), catalogue size, all-time orders and fulfilment record, open disputes and tickets, money owed to them (unreleased earnings, wallet balances), and their five most recent orders. Takes a business id or a (partial) business name.',
        input_schema: { type: 'object', required: ['business'], properties: { business: { type: 'string' } } },
      },
      {
        name: 'get_customer',
        description:
          'One customer in full: profile, when they joined and last signed in, order history totals (orders, paid total, last order), open disputes, returns and tickets, and their five most recent orders. Takes a user id, email, phone or (partial) name.',
        input_schema: { type: 'object', required: ['customer'], properties: { customer: { type: 'string' } } },
      },
      {
        name: 'get_ticket',
        description: 'One support ticket with who raised it, who it is assigned to, its age, and the reply thread (latest ten).',
        input_schema: { type: 'object', required: ['ticket_id'], properties: { ticket_id: { type: 'string' } } },
      },
      {
        name: 'get_dispute',
        description:
          "One dispute with the order it is on, who raised it and why, the vendor's response (or that there is none), evidence counts, age, and the resolution if decided. Takes a dispute id or the order reference.",
        input_schema: { type: 'object', required: ['dispute'], properties: { dispute: { type: 'string', description: 'Dispute id or order reference.' } } },
      },
      {
        name: 'get_stuck_orders',
        description:
          `Open orders that have stopped moving, grouped by why and by vendor: paid but unconfirmed for over 24h, confirmed but unshipped past the fulfilment deadline, in transit over 10 days, bespoke pre-ship photos waiting on the customer over 48h. Looks back ${LOOKBACK_DAYS} days. A snapshot - no period.`,
        input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max orders per reason (default 10, max 25).' } } },
      },
      {
        name: 'get_payment_reconciliation',
        description:
          'Money that does not add up, for a period: paid orders with no successful payment transaction on record, payment transactions that succeeded on orders not marked paid, payment attempts stuck pending or failed for over an hour, refunds recorded on orders without a refund transaction and refund transactions on orders that show no refund, plus paid value by processor (Paystack / Stripe). Finance only.',
        input_schema: { type: 'object', properties: { ...RANGE_PROPS, limit: { type: 'number', description: 'Max items per list (default 10, max 25).' } } },
      },
      {
        name: 'get_vendor_money_tally',
        description:
          "Do vendor money records agree? Checks every vendor wallet against its records: pending earnings vs the unreleased earning rows, and the wallet balance vs its transaction history (top-ups + released earnings - withdrawals - token purchases - clawbacks). For paid orders in the period, checks each order's vendor earnings and commission against its earning rows, and lists paid orders with no earnings at all and released earnings with no history entry. Pass a vendor to explain that vendor's differences instead: which records cause them (earnings paid with no history entry, the same earning paid more than once, old payouts missing from history or taken twice, money taken back with no entry), how much each accounts for, whether it predates the fix, and what is left unexplained. Finance only.",
        input_schema: { type: 'object', properties: { ...RANGE_PROPS, limit: { type: 'number', description: 'Max items per list (default 10, max 25).' }, business: { type: 'string', description: 'Optional vendor name, email or id: explain this vendor only.' } } },
      },
      {
        name: 'get_search_gaps',
        description:
          "What shoppers search for and do not find: terms searched at least twice in the period where half or more of the searches returned nothing - demand the catalogue is not supplying - plus the most-searched terms overall. Searches recorded before result counts were kept are counted but not judged.",
        input_schema: { type: 'object', properties: { ...RANGE_PROPS, limit: { type: 'number', description: 'Max terms (default 15, max 40).' } } },
      },
      {
        name: 'get_catalogue_quality',
        description:
          'Platform-wide listing quality: how many active products are missing photos, a description, audience, colours, sizes, a size guide or a price, and the vendors with the most incomplete catalogues (share of their listings with gaps). These are the fields search and the shopper AI filter on, so a gap is a product nobody is shown. Pairs with the nudge_vendor action.',
        input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max vendors to list (default 15, max 40).' } } },
      },
      {
        name: 'get_vendor_health',
        description:
          'Vendor reliability for a period: per vendor, late-shipment rate, cancellation rate, dispute rate, return rate and rating, against the platform medians, with the vendors breaching thresholds flagged and the reasons named. Give `business` to see one vendor against the medians. Vendors with under three orders in the period are shown but never flagged.',
        input_schema: { type: 'object', properties: { business: { type: 'string', description: 'Optional: one vendor, by id or (partial) name.' }, ...RANGE_PROPS } },
      },
    ];
  }

  handles(name: string): boolean {
    return this.getToolDefs().some((t) => t.name === name);
  }

  async execute(name: string, args: any, allowed: Set<string> | null): Promise<any> {
    const a = args ?? {};
    switch (name) {
      case 'get_work_queue': return this.workQueue(a, allowed);
      case 'search': return this.search(a);
      case 'get_order': return this.order(a);
      case 'get_vendor': return this.vendor(a);
      case 'get_customer': return this.customer(a);
      case 'get_ticket': return this.ticket(a);
      case 'get_dispute': return this.dispute(a);
      case 'get_stuck_orders': return this.stuckOrders(a);
      case 'get_vendor_health': return this.vendorHealthReport(a);
      case 'get_payment_reconciliation': return this.paymentReconciliation(a);
      case 'get_vendor_money_tally': return this.vendorMoneyTally(a);
      case 'get_search_gaps': return this.searchGapsReport(a);
      case 'get_catalogue_quality': return this.catalogueQuality(a);
      default: return { error: `Unknown tool: ${name}` };
    }
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  private clamp(n: any, def: number, max: number): number {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : def;
  }

  private daysSince(d?: any, now = new Date()): number | null {
    if (!d) return null;
    return Math.round(((now.getTime() - new Date(d).getTime()) / 86_400_000) * 10) / 10;
  }

  private isId(s: string) {
    return Types.ObjectId.isValid(s) && String(new Types.ObjectId(s)) === s;
  }

  private async businessNames(ids: (string | Types.ObjectId)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.map(String).filter((id) => this.isId(id)))];
    if (!unique.length) return new Map();
    const rows = await this.businessModel.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } }).select('business_name').lean();
    return new Map((rows as any[]).map((b) => [String(b._id), b.business_name]));
  }

  private async userNames(ids: (string | Types.ObjectId)[]): Promise<Map<string, { name: string; email?: string; type?: string }>> {
    const unique = [...new Set(ids.map(String).filter((id) => this.isId(id)))];
    if (!unique.length) return new Map();
    const rows = await this.userModel.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } }).select('full_name email type').lean();
    return new Map((rows as any[]).map((u) => [String(u._id), { name: u.full_name, email: u.email, type: u.type }]));
  }

  private async findBusiness(typed: string): Promise<{ match: any } | { ambiguous: string[] } | { none: true }> {
    const t = String(typed ?? '').trim();
    if (!t) return { none: true };
    if (this.isId(t)) {
      const b = await this.businessModel.findById(t).lean();
      return b ? { match: b } : { none: true };
    }
    const rx = new RegExp(escapeRegex(t), 'i');
    const rows = await this.businessModel.find({ $or: [{ business_name: rx }, { business_email: rx }] }).limit(20).lean();
    return pickByName(rows as any[], t, (b: any) => b.business_name ?? '');
  }

  private async findCustomer(typed: string): Promise<{ match: any } | { ambiguous: string[] } | { none: true }> {
    const t = String(typed ?? '').trim();
    if (!t) return { none: true };
    if (this.isId(t)) {
      const u = await this.userModel.findById(t).lean();
      return u ? { match: u } : { none: true };
    }
    const rx = new RegExp(escapeRegex(t), 'i');
    const rows = await this.userModel
      .find({ type: 'customer', $or: [{ full_name: rx }, { email: rx }, { phone_number: rx }, { username: rx }] })
      .select('full_name email phone_number username gender createdAt last_login_at wishlist')
      .limit(20)
      .lean();
    const exactEmail = (rows as any[]).filter((u) => String(u.email ?? '').toLowerCase() === t.toLowerCase());
    if (exactEmail.length === 1) return { match: exactEmail[0] };
    return pickByName(rows as any[], t, (u: any) => u.full_name ?? u.email ?? '');
  }

  // ── Work queue ────────────────────────────────────────────────────────────

  private async workQueue(args: any, allowed: Set<string> | null) {
    const limit = this.clamp(args.limit, 10, 25);
    const now = new Date();
    const can = (section: string) => allowed === null || allowed.has(QUEUE_GATES[section]);
    const sections: Record<string, any> = {};
    const omitted: string[] = [];

    if (can('products_pending_review')) {
      const filter = { $or: [{ 'moderation.status': 'pending' }, { moderation: { $exists: false } }], status: { $ne: 'archived' } };
      const [count, rows] = await Promise.all([
        this.productModel.countDocuments(filter),
        this.productModel.find(filter).sort({ createdAt: 1 }).limit(limit).select('kind status business createdAt clothing.name fabric.name accessory.name').lean(),
      ]);
      const names = await this.businessNames((rows as any[]).map((p) => p.business));
      sections.products_pending_review = {
        count,
        items: (rows as any[]).map((p) => ({ product_id: String(p._id), product: productName(p), kind: p.kind, vendor: names.get(String(p.business)) ?? null, waiting_days: this.daysSince(p.createdAt, now) })),
      };
    } else omitted.push('products_pending_review');

    if (can('vendor_applications')) {
      const filter = { status: { $in: ['pending', 'in-review'] } };
      const [count, rows] = await Promise.all([
        this.businessModel.countDocuments(filter),
        this.businessModel.find(filter).sort({ createdAt: 1 }).limit(limit).select('business_name status createdAt verification_submitted_at city state').lean(),
      ]);
      sections.vendor_applications = {
        count,
        items: (rows as any[]).map((b) => ({ business_id: String(b._id), business: b.business_name, status: b.status, location: [b.city, b.state].filter(Boolean).join(', ') || null, waiting_days: this.daysSince(b.verification_submitted_at ?? b.createdAt, now) })),
      };
    } else omitted.push('vendor_applications');

    if (can('tickets')) {
      const active = { status: { $in: ['open', 'in_progress'] } };
      const [unassignedCount, unassigned, unansweredCount, unanswered] = await Promise.all([
        this.ticketModel.countDocuments({ ...active, $or: [{ assigned_to: null }, { assigned_to: { $exists: false } }] }),
        this.ticketModel.find({ ...active, $or: [{ assigned_to: null }, { assigned_to: { $exists: false } }] }).sort({ createdAt: 1 }).limit(limit).select('issue_type business customer createdAt status').lean(),
        this.ticketModel.countDocuments({ ...active, replies: { $size: 0 }, createdAt: { $lt: new Date(now.getTime() - 48 * 3_600_000) } }),
        this.ticketModel.find({ ...active, replies: { $size: 0 }, createdAt: { $lt: new Date(now.getTime() - 48 * 3_600_000) } }).sort({ createdAt: 1 }).limit(limit).select('issue_type business customer createdAt status assigned_to').lean(),
      ]);
      const all = [...(unassigned as any[]), ...(unanswered as any[])];
      const [bNames, uNames] = await Promise.all([this.businessNames(all.map((t) => t.business).filter(Boolean)), this.userNames(all.map((t) => t.customer).filter(Boolean))]);
      const row = (t: any) => ({
        ticket_id: String(t._id),
        issue: t.issue_type,
        from: t.business ? `vendor ${bNames.get(String(t.business)) ?? ''}`.trim() : t.customer ? `customer ${uNames.get(String(t.customer))?.name ?? ''}`.trim() : 'unknown',
        status: t.status,
        waiting_days: this.daysSince(t.createdAt, now),
      });
      sections.tickets = {
        unassigned: { count: unassignedCount, items: (unassigned as any[]).map(row) },
        unanswered_over_48h: { count: unansweredCount, items: (unanswered as any[]).map(row) },
      };
    } else omitted.push('tickets');

    if (can('disputes')) {
      const filter = { status: { $in: ['open', 'under_review'] } };
      const [count, rows] = await Promise.all([
        this.disputeModel.countDocuments(filter),
        this.disputeModel.find(filter).sort({ createdAt: 1 }).limit(limit).select('order_reference reason initiated_by status vendor_response refund_amount business createdAt').lean(),
      ]);
      const names = await this.businessNames((rows as any[]).map((d) => d.business));
      sections.disputes = {
        count,
        items: (rows as any[]).map((d) => ({ dispute_id: String(d._id), order: d.order_reference, reason: d.reason, raised_by: d.initiated_by ?? 'customer', vendor: names.get(String(d.business)) ?? null, vendor_responded: !!d.vendor_response, status: d.status, waiting_days: this.daysSince(d.createdAt, now) })),
      };
    } else omitted.push('disputes');

    if (can('returns')) {
      const stuckOnVendor = { status: 'requested', createdAt: { $lt: new Date(now.getTime() - 3 * 86_400_000) } };
      const awaitingRefund = { status: 'received' };
      const [c1, r1, c2, r2] = await Promise.all([
        this.returnModel.countDocuments(stuckOnVendor),
        this.returnModel.find(stuckOnVendor).sort({ createdAt: 1 }).limit(limit).select('order_reference reason business refund_amount createdAt').lean(),
        this.returnModel.countDocuments(awaitingRefund),
        this.returnModel.find(awaitingRefund).sort({ received_at: 1 }).limit(limit).select('order_reference reason business refund_amount received_at createdAt').lean(),
      ]);
      const names = await this.businessNames([...(r1 as any[]), ...(r2 as any[])].map((r) => r.business));
      const row = (r: any) => ({ return_id: String(r._id), order: r.order_reference, reason: r.reason, vendor: names.get(String(r.business)) ?? null, refund_amount: r.refund_amount, waiting_days: this.daysSince(r.received_at ?? r.createdAt, now) });
      sections.returns = {
        vendor_has_not_decided_over_3d: { count: c1, items: (r1 as any[]).map(row) },
        received_awaiting_refund: { count: c2, items: (r2 as any[]).map(row) },
      };
    } else omitted.push('returns');

    if (can('payouts_due')) {
      const due = await this.earningModel.aggregate([
        { $match: { released: false, release_date: { $ne: null, $lte: now } } },
        { $group: { _id: '$business', amount: { $sum: '$net_amount' }, oldest: { $min: '$release_date' }, items: { $sum: 1 } } },
        { $sort: { oldest: 1 } },
        { $limit: limit },
      ]);
      const totalAgg = await this.earningModel.aggregate([
        { $match: { released: false, release_date: { $ne: null, $lte: now } } },
        { $group: { _id: null, amount: { $sum: '$net_amount' }, vendors: { $addToSet: '$business' } } },
      ]);
      const names = await this.businessNames(due.map((d: any) => d._id));
      sections.payouts_due = {
        total_amount: Math.round((totalAgg[0]?.amount ?? 0) * 100) / 100,
        vendors: totalAgg[0]?.vendors?.length ?? 0,
        items: due.map((d: any) => ({ business_id: String(d._id), vendor: names.get(String(d._id)) ?? null, amount: Math.round(d.amount * 100) / 100, earnings: d.items, overdue_days: this.daysSince(d.oldest, now) })),
      };
    } else omitted.push('payouts_due');

    return { snapshot: now.toISOString(), currency: 'NGN', sections, ...(omitted.length ? { omitted_for_role: omitted } : {}) };
  }

  // ── Search ────────────────────────────────────────────────────────────────

  private async search(args: any) {
    const q = String(args.query ?? '').trim();
    if (!q) return { error: 'Give query.' };
    const rx = new RegExp(escapeRegex(q), 'i');
    const id = this.isId(q) ? new Types.ObjectId(q) : null;

    const [orders, businesses, customers, products, tickets, disputes] = await Promise.all([
      this.orderModel.find({ reference: rx }).sort({ createdAt: -1 }).limit(5).select('reference status total createdAt').lean(),
      this.businessModel.find({ $or: [{ business_name: rx }, { business_email: rx }] }).limit(5).select('business_name status city state').lean(),
      this.userModel.find({ type: 'customer', $or: [{ full_name: rx }, { email: rx }, { phone_number: rx }] }).limit(5).select('full_name email phone_number').lean(),
      this.productModel.find({ $or: [{ 'clothing.name': rx }, { 'fabric.name': rx }, { 'accessory.name': rx }] }).limit(5).select('kind status business clothing.name fabric.name accessory.name').lean(),
      id ? this.ticketModel.find({ _id: id }).select('issue_type status').lean() : Promise.resolve([]),
      id ? this.disputeModel.find({ _id: id }).select('order_reference status reason').lean() : this.disputeModel.find({ order_reference: rx }).limit(5).select('order_reference status reason').lean(),
    ]);
    const names = await this.businessNames((products as any[]).map((p) => p.business));
    return {
      query: q,
      orders: (orders as any[]).map((o) => ({ reference: o.reference, status: o.status, total: o.total, placed_at: o.createdAt })),
      vendors: (businesses as any[]).map((b) => ({ business_id: String(b._id), business: b.business_name, status: b.status, location: [b.city, b.state].filter(Boolean).join(', ') || null })),
      customers: (customers as any[]).map((u) => ({ user_id: String(u._id), name: u.full_name, email: u.email, phone: u.phone_number ?? null })),
      products: (products as any[]).map((p) => ({ product_id: String(p._id), product: productName(p), kind: p.kind, status: p.status, vendor: names.get(String(p.business)) ?? null })),
      tickets: (tickets as any[]).map((t) => ({ ticket_id: String(t._id), issue: t.issue_type, status: t.status })),
      disputes: (disputes as any[]).map((d) => ({ dispute_id: String(d._id), order: d.order_reference, status: d.status, reason: d.reason })),
    };
  }

  // ── One order ─────────────────────────────────────────────────────────────

  private async order(args: any) {
    const ref = String(args.reference ?? '').trim();
    if (!ref) return { error: 'Give reference.' };
    const o: any = await this.orderModel
      .findOne({ reference: new RegExp(`^${escapeRegex(ref)}$`, 'i') })
      .populate({ path: 'customer', select: 'full_name email phone_number' })
      .populate({ path: 'items.product', select: 'kind clothing.name fabric.name accessory.name' })
      .populate({ path: 'bespoke_design', select: 'name category reference' })
      .lean();
    if (!o) return { error: `No order "${ref}".` };
    const now = new Date();
    const vendorIds = [...(o.items || []).map((i: any) => i.business), ...(o.shipments || []).map((s: any) => s.business)].filter(Boolean);
    const [names, disputes, returns] = await Promise.all([
      this.businessNames(vendorIds),
      this.disputeModel.find({ order: o._id }).select('reason status initiated_by vendor_response refund_amount createdAt resolved_at').lean(),
      this.returnModel.find({ order: o._id }).select('reason status refund_amount createdAt refunded_at').lean(),
    ]);

    return {
      currency: 'NGN',
      data: {
        reference: o.reference,
        status: o.status,
        payment_status: o.payment_status ?? null,
        type: o.order_type ?? 'standard',
        placed_at: o.createdAt,
        age_days: this.daysSince(o.createdAt, now),
        customer: o.customer && typeof o.customer === 'object' ? { user_id: String(o.customer._id), name: o.customer.full_name, email: o.customer.email, phone: o.customer.phone_number ?? null } : null,
        delivery: o.address ? { state: o.address.state ?? null, city: o.address.city ?? null } : null,
        totals: { subtotal: o.subtotal, shipping_fee: o.shipping_fee, total: o.total, vendor_earnings: o.vendor_earnings ?? null, platform_commission: o.platform_commission ?? null },
        items: (o.items || []).map((i: any) => ({
          product: i.product && typeof i.product === 'object' ? productName(i.product) : null,
          vendor: names.get(String(i.business)) ?? null,
          amount: i.total_price ?? null,
          rejected: !!i.rejected,
          rejection_reason: i.rejection_reason ?? null,
        })),
        shipments: (o.shipments || []).map((s: any) => {
          const row = describeOrder(o, s.business, now);
          return {
            vendor: names.get(String(s.business)) ?? null,
            stage: row.stage,
            confirmed_at: s.confirmed_at ?? null,
            shipped_at: s.shipped_at ?? null,
            delivered_at: s.delivered_at ?? null,
            deadline: s.fulfillment_deadline ?? null,
            overdue: row.overdue,
            rejected: !!s.rejected,
            rejection_reason: s.rejection_reason ?? null,
            courier: s.courier_name ?? null,
            tracking_number: s.tracking_number ?? null,
            items: vendorItems(o, s.business).length,
          };
        }),
        bespoke: o.order_type === 'bespoke' ? {
          design: o.bespoke_design && typeof o.bespoke_design === 'object' ? { reference: o.bespoke_design.reference, name: o.bespoke_design.name, category: o.bespoke_design.category } : null,
          preship: o.preship ? { status: o.preship.status, submitted_at: o.preship.submitted_at ?? null, reviewed_at: o.preship.reviewed_at ?? null, photos: (o.preship.photos || []).length } : null,
          fit_feedback: o.fit_feedback ?? null,
        } : null,
        late_penalty: o.late_penalty_applied ? { amount: o.late_penalty_amount, days: o.late_penalty_days } : null,
        customer_satisfied: o.customer_satisfied ?? null,
        disputes: (disputes as any[]).map((d) => ({ dispute_id: String(d._id), reason: d.reason, status: d.status, raised_by: d.initiated_by ?? 'customer', vendor_responded: !!d.vendor_response, refund_amount: d.refund_amount ?? null, opened_at: d.createdAt, resolved_at: d.resolved_at ?? null })),
        returns: (returns as any[]).map((r) => ({ return_id: String(r._id), reason: r.reason, status: r.status, refund_amount: r.refund_amount, requested_at: r.createdAt, refunded_at: r.refunded_at ?? null })),
      },
    };
  }

  // ── One vendor ────────────────────────────────────────────────────────────

  private async vendor(args: any) {
    const pick = await this.findBusiness(String(args.business ?? ''));
    if ('none' in pick) return { error: `No vendor matching "${args.business}".` };
    if ('ambiguous' in pick) return { error: `Several vendors match: ${pick.ambiguous.join(', ')}. Which one?` };
    const b: any = pick.match;
    const bid = b._id;
    const now = new Date();

    const [products, orders, openDisputes, openTickets, unreleased, lifetimeEarned, wallet, recent, fulfilment, team] = await Promise.all([
      this.productModel.aggregate([{ $match: { business: bid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.orderModel.countDocuments({ 'items.business': bid, status: { $ne: 'pending' } }),
      this.disputeModel.countDocuments({ business: bid, status: { $in: ['open', 'under_review'] } }),
      this.ticketModel.countDocuments({ business: bid, status: { $in: ['open', 'in_progress'] } }),
      this.earningModel.aggregate([{ $match: { business: bid, released: false } }, { $group: { _id: null, amount: { $sum: '$net_amount' }, n: { $sum: 1 } } }]),
      // Everything ever credited to the vendor that still stands (held or
      // released; reversed earnings are deleted). The business record's
      // lifetime_earned counter is never written, so it always read 0 and
      // was flagged as a ledger gap it is not.
      this.earningModel.aggregate([{ $match: { business: bid } }, { $group: { _id: null, amount: { $sum: '$net_amount' } } }]),
      this.walletModel.findOne({ business: bid }).select('balance available_balance pending_balance').lean(),
      this.orderModel.find({ 'items.business': bid, status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(5).select('reference status createdAt items shipments').lean(),
      this.orderModel.aggregate([
        { $match: { 'shipments.business': bid, createdAt: { $gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) } } },
        { $unwind: '$shipments' },
        { $match: { 'shipments.business': bid } },
        {
          $group: {
            _id: null,
            shipped: { $sum: { $cond: [{ $ifNull: ['$shipments.shipped_at', false] }, 1, 0] } },
            late: { $sum: { $cond: [{ $and: [{ $ifNull: ['$shipments.shipped_at', false] }, { $ifNull: ['$shipments.fulfillment_deadline', false] }, { $gt: ['$shipments.shipped_at', '$shipments.fulfillment_deadline'] }] }, 1, 0] } },
            rejected: { $sum: { $cond: ['$shipments.rejected', 1, 0] } },
          },
        },
      ]),
      this.teamMemberModel.find({ business: bid }).populate({ path: 'role', select: 'name' }).select('user full_name email role accepted is_active is_owner createdAt').lean(),
    ]);
    const w: any = wallet;
    const f: any = fulfilment[0] ?? {};
    const productCounts = Object.fromEntries(products.map((p: any) => [p._id, p.n]));

    return {
      currency: 'NGN',
      data: {
        business_id: String(bid),
        business: b.business_name,
        email: b.business_email ?? null,
        phone: b.business_phone_number ?? null,
        status: b.status,
        verified: b.status === 'verified',
        is_active: b.is_active !== false,
        is_flagged: !!b.is_flagged,
        is_featured: !!b.is_featured,
        location: [b.city, b.state, b.country].filter(Boolean).join(', ') || null,
        joined_at: b.createdAt,
        accepts_bespoke: b.accepts_bespoke !== false,
        // Who notifications reach: a nudge about listings goes to owner +
        // operations + marketing; about orders to owner + operations + tailor.
        // A member not accepted, not active, or in another role gets nothing.
        team: (team as any[]).map((m) => ({
          name: m.full_name ?? null,
          email: m.email ?? null,
          role: (m.role as any)?.name ?? null,
          owner: !!m.is_owner,
          accepted: !!m.accepted,
          active: m.is_active !== false,
          has_account: !!m.user,
          user_id: m.user ? String(m.user) : null,
        })),
        verification: {
          submitted_at: b.verification_submitted_at ?? null,
          decided_at: b.verification_decided_at ?? null,
          attempts: b.verification_attempts ?? 0,
          message: b.verification_message ?? null,
          identity: b.verification?.identity ? 'provided' : 'missing',
          bank: b.verification?.bank ? 'provided' : 'missing',
        },
        catalogue: { active: productCounts.active ?? 0, draft: productCounts.draft ?? 0, archived: productCounts.archived ?? 0 },
        record: {
          orders_all_time: orders,
          total_items_sold: b.total_items_sold ?? 0,
          successful_deliveries: b.successful_deliveries ?? 0,
          returned_deliveries: b.returned_deliveries ?? 0,
          success_rate: b.success_rate ?? null,
          [`last_${LOOKBACK_DAYS}_days`]: { shipped: f.shipped ?? 0, late: f.late ?? 0, rejected: f.rejected ?? 0 },
        },
        open: { disputes: openDisputes, tickets: openTickets },
        money: {
          unreleased_earnings: Math.round((unreleased[0]?.amount ?? 0) * 100) / 100,
          unreleased_items: unreleased[0]?.n ?? 0,
          wallet_available: w?.available_balance ?? w?.balance ?? null,
          wallet_pending: w?.pending_balance ?? null,
          lifetime_earned: Math.round((lifetimeEarned[0]?.amount ?? 0) * 100) / 100,
          lifetime_paid_out: b.lifetime_paid_out ?? null,
          last_payout_at: b.last_payout_date ?? null,
        },
        recent_orders: (recent as any[]).map((o) => { const r = describeOrder(o, bid, now); return { reference: o.reference, status: o.status, stage: r.stage, amount: r.amount, placed_at: o.createdAt }; }),
      },
    };
  }

  // ── One customer ──────────────────────────────────────────────────────────

  private async customer(args: any) {
    const pick = await this.findCustomer(String(args.customer ?? ''));
    if ('none' in pick) return { error: `No customer matching "${args.customer}".` };
    if ('ambiguous' in pick) return { error: `Several customers match: ${pick.ambiguous.join(', ')}. Which one?` };
    const u: any = pick.match;
    const uid = u._id;

    const [orderAgg, recent, disputes, returns, tickets] = await Promise.all([
      this.orderModel.aggregate([
        { $match: { customer: uid, status: { $ne: 'pending' } } },
        { $group: { _id: null, orders: { $sum: 1 }, paid_total: { $sum: { $cond: [{ $eq: ['$payment_status', 'paid'] }, '$total', 0] } }, last_order_at: { $max: '$createdAt' }, first_order_at: { $min: '$createdAt' }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } },
      ]),
      this.orderModel.find({ customer: uid, status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(5).select('reference status total order_type createdAt').lean(),
      this.disputeModel.countDocuments({ customer: uid, status: { $in: ['open', 'under_review'] } }),
      this.returnModel.countDocuments({ customer: uid, status: { $nin: ['refund_processed', 'closed', 'vendor_rejected'] } }),
      this.ticketModel.countDocuments({ customer: uid, status: { $in: ['open', 'in_progress'] } }),
    ]);
    const a: any = orderAgg[0] ?? {};
    return {
      currency: 'NGN',
      data: {
        user_id: String(uid),
        name: u.full_name,
        email: u.email,
        phone: u.phone_number ?? null,
        username: u.username ?? null,
        gender: u.gender ?? null,
        joined_at: u.createdAt,
        last_login_at: u.last_login_at ?? null,
        wishlist_items: Array.isArray(u.wishlist) ? u.wishlist.length : 0,
        orders: { count: a.orders ?? 0, paid_total: Math.round((a.paid_total ?? 0) * 100) / 100, cancelled: a.cancelled ?? 0, first_order_at: a.first_order_at ?? null, last_order_at: a.last_order_at ?? null },
        open: { disputes, returns, tickets },
        recent_orders: (recent as any[]).map((o) => ({ reference: o.reference, status: o.status, type: o.order_type ?? 'standard', total: o.total, placed_at: o.createdAt })),
      },
    };
  }

  // ── One ticket ────────────────────────────────────────────────────────────

  private async ticket(args: any) {
    const id = String(args.ticket_id ?? '').trim();
    if (!this.isId(id)) return { error: 'Give a valid ticket_id.' };
    const t: any = await this.ticketModel.findById(id).lean();
    if (!t) return { error: 'No such ticket.' };
    const replies: any[] = await this.ticketReplyModel.find({ ticket_id: t._id }).sort({ createdAt: -1 }).limit(10).lean();
    const [bNames, uNames] = await Promise.all([
      this.businessNames([t.business].filter(Boolean)),
      this.userNames([t.customer, t.assigned_to, ...replies.map((r) => r.sender)].filter(Boolean)),
    ]);
    const now = new Date();
    return {
      data: {
        ticket_id: String(t._id),
        issue: t.issue_type,
        description: String(t.description ?? '').slice(0, 1000),
        status: t.status,
        raised_by: t.business ? { kind: 'vendor', name: bNames.get(String(t.business)) ?? null, business_id: String(t.business) } : t.customer ? { kind: 'customer', name: uNames.get(String(t.customer))?.name ?? null, user_id: String(t.customer) } : null,
        assigned_to: t.assigned_to ? { user_id: String(t.assigned_to), name: uNames.get(String(t.assigned_to))?.name ?? null } : null,
        opened_at: t.createdAt,
        age_days: this.daysSince(t.createdAt, now),
        attachments: (t.attachments || []).length,
        replies: replies.reverse().map((r) => {
          const who = uNames.get(String(r.sender));
          return { at: r.createdAt, from: who?.name ?? null, from_platform: who?.type === 'platform' || who?.type === 'admin', message: String(r.message ?? '').slice(0, 600) };
        }),
      },
    };
  }

  // ── One dispute ───────────────────────────────────────────────────────────

  private async dispute(args: any) {
    const key = String(args.dispute ?? '').trim();
    if (!key) return { error: 'Give dispute (id or order reference).' };
    const d: any = this.isId(key)
      ? await this.disputeModel.findById(key).lean()
      : await this.disputeModel.findOne({ order_reference: new RegExp(`^${escapeRegex(key)}$`, 'i') }).sort({ createdAt: -1 }).lean();
    if (!d) return { error: `No dispute for "${key}".` };
    const [order, bNames, uNames] = await Promise.all([
      this.orderModel.findById(d.order).select('reference status payment_status total order_type createdAt').lean(),
      this.businessNames([d.business].filter(Boolean)),
      this.userNames([d.customer, d.resolved_by].filter(Boolean)),
    ]);
    const o: any = order;
    return {
      currency: 'NGN',
      data: {
        dispute_id: String(d._id),
        status: d.status,
        reason: d.reason,
        raised_by: d.initiated_by ?? 'customer',
        body_part: d.body_part ?? null,
        description: String(d.description ?? '').slice(0, 1000),
        opened_at: d.createdAt,
        age_days: this.daysSince(d.createdAt),
        customer: d.customer ? { user_id: String(d.customer), name: uNames.get(String(d.customer))?.name ?? null } : null,
        vendor: d.business ? { business_id: String(d.business), name: bNames.get(String(d.business)) ?? null } : null,
        vendor_response: d.vendor_response ? String(d.vendor_response).slice(0, 1000) : null,
        evidence: { customer: (d.evidence_urls || []).length, vendor: (d.vendor_evidence_urls || []).length },
        order: o ? { reference: o.reference, status: o.status, payment_status: o.payment_status ?? null, total: o.total, type: o.order_type ?? 'standard', placed_at: o.createdAt } : { reference: d.order_reference },
        resolution: String(d.status).startsWith('resolved') || d.status === 'closed'
          ? { refund_amount: d.refund_amount ?? null, resolved_at: d.resolved_at ?? null, resolved_by: d.resolved_by ? uNames.get(String(d.resolved_by))?.name ?? null : null, admin_notes: d.admin_notes ?? null }
          : null,
      },
    };
  }

  // ── Stuck orders ──────────────────────────────────────────────────────────

  private async stuckOrders(args: any) {
    const limit = this.clamp(args.limit, 10, 25);
    const now = new Date();
    const orders = await this.orderModel
      .find({ status: { $in: OPEN_ORDER_STATUSES }, createdAt: { $gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) } })
      .select('reference status payment_status order_type createdAt updatedAt items.business items.total_price items.rejected shipments preship fulfillment_deadline')
      .lean();
    const names = await this.businessNames((orders as any[]).flatMap((o) => (o.shipments || []).map((s: any) => s.business)));
    const report = stuckOrdersFrom(orders as any[], now, (id) => names.get(id) ?? id);
    const trim = (xs: any[]) => xs.slice(0, limit).map((x) => ({ reference: x.reference, vendor: x.vendor, type: x.type, placed_at: x.placed_at, amount: x.amount, hours_over: x.hours_over, deadline: x.deadline }));
    return {
      snapshot: now.toISOString(),
      currency: 'NGN',
      lookback_days: LOOKBACK_DAYS,
      data: {
        total: report.total,
        by_vendor: report.by_vendor.slice(0, limit),
        unconfirmed_over_24h: { count: report.unconfirmed.length, items: trim(report.unconfirmed) },
        past_deadline_unshipped: { count: report.past_deadline.length, items: trim(report.past_deadline) },
        in_transit_over_10d: { count: report.in_transit_too_long.length, items: trim(report.in_transit_too_long) },
        preship_waiting_on_customer_over_48h: { count: report.preship_waiting_on_customer.length, items: trim(report.preship_waiting_on_customer) },
      },
    };
  }

  // ── Payment reconciliation ────────────────────────────────────────────────

  private async paymentReconciliation(args: any) {
    const range = resolveRange((args ?? {}) as RangeArgs);
    const limit = this.clamp(args.limit, 10, 25);
    const window = { createdAt: { $gte: range.start, $lt: range.end } };
    const staleBefore = new Date(Date.now() - 3_600_000);

    const [paidOrders, orderTxns, byProcessor] = await Promise.all([
      this.orderModel.find({ ...window, payment_status: 'paid' }).select('reference total processor refund_status createdAt').lean(),
      this.transactionModel.find({ ...window, order: { $ne: null } }).select('order type status amount reference payment_method createdAt').lean(),
      this.orderModel.aggregate([
        { $match: { ...window, payment_status: 'paid' } },
        { $group: { _id: { $ifNull: ['$processor', 'paystack'] }, orders: { $sum: 1 }, value: { $sum: '$total' } } },
      ]),
    ]);

    const txByOrder = new Map<string, any[]>();
    for (const t of orderTxns as any[]) {
      const k = String(t.order);
      txByOrder.set(k, [...(txByOrder.get(k) ?? []), t]);
    }
    const isPaymentTx = (t: any) => t.type !== 'refund';
    const paidIds = new Set((paidOrders as any[]).map((o) => String(o._id)));

    const paidWithoutTransaction = (paidOrders as any[]).filter((o) => !(txByOrder.get(String(o._id)) ?? []).some((t) => isPaymentTx(t) && t.status === 'success'));
    const successNotPaid: any[] = [];
    const stuck: any[] = [];
    for (const t of orderTxns as any[]) {
      if (!isPaymentTx(t)) continue;
      if (t.status === 'success' && !paidIds.has(String(t.order))) successNotPaid.push(t);
      if (['pending', 'failed'].includes(t.status) && new Date(t.createdAt) < staleBefore) stuck.push(t);
    }
    const refundOrdersNoTx = (paidOrders as any[]).filter((o) => ['partial', 'refunded'].includes(o.refund_status) && !(txByOrder.get(String(o._id)) ?? []).some((t) => t.type === 'refund' && t.status === 'success'));
    const refundTxNoFlag: any[] = [];
    for (const t of orderTxns as any[]) {
      if (t.type === 'refund' && t.status === 'success') {
        const o = (paidOrders as any[]).find((x) => String(x._id) === String(t.order));
        if (o && (!o.refund_status || o.refund_status === 'none')) refundTxNoFlag.push({ ...t, reference_order: o.reference });
      }
    }
    const refs = new Map((paidOrders as any[]).map((o) => [String(o._id), o.reference]));
    const txRow = (t: any) => ({ transaction: t.reference, order: refs.get(String(t.order)) ?? String(t.order), type: t.type, status: t.status, amount: t.amount, method: t.payment_method ?? null, at: t.createdAt });

    return {
      ...({ period: range.label, currency: 'NGN' }),
      data: {
        totals: {
          paid_orders: paidOrders.length,
          paid_value: Math.round((paidOrders as any[]).reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100,
          by_processor: byProcessor.map((r: any) => ({ processor: r._id, orders: r.orders, value: Math.round(r.value * 100) / 100 })),
          paid_without_transaction: paidWithoutTransaction.length,
          transaction_success_order_not_paid: successNotPaid.length,
          payment_attempts_stuck: stuck.length,
          refund_flag_without_transaction: refundOrdersNoTx.length,
          refund_transaction_without_flag: refundTxNoFlag.length,
        },
        paid_without_transaction: paidWithoutTransaction.slice(0, limit).map((o) => ({ order: o.reference, total: o.total, processor: o.processor ?? 'paystack', at: o.createdAt })),
        transaction_success_order_not_paid: successNotPaid.slice(0, limit).map(txRow),
        payment_attempts_stuck: stuck.slice(0, limit).map(txRow),
        refund_flag_without_transaction: refundOrdersNoTx.slice(0, limit).map((o) => ({ order: o.reference, refund_status: o.refund_status, total: o.total })),
        refund_transaction_without_flag: refundTxNoFlag.slice(0, limit).map((t) => ({ ...txRow(t), order: t.reference_order })),
        note: 'Card payments confirmed by the processor webhook mark the order paid directly and may carry no transaction record; "paid without transaction" is a list to check, not proof of a problem. Stuck attempts are pending/failed for over an hour.',
      },
    };
  }

  // ── Vendor money tally ────────────────────────────────────────────────────

  private async vendorMoneyTally(args: any) {
    if (args?.business) return this.explainVendorMoneyFor(args);
    const range = resolveRange((args ?? {}) as RangeArgs);
    const limit = this.clamp(args.limit, 10, 25);
    const num = (v: any) => Number(v) || 0;

    // Wallets and their records are all-time (a balance is cumulative).
    const wallets = await this.walletModel
      .find({ business: { $ne: null } })
      .select('business balance pending_balance owed_balance')
      .limit(5000)
      .lean();
    const walletIds = (wallets as any[]).map((w) => w._id);
    const walletForms = [...walletIds, ...walletIds.map((id) => String(id))];
    const businessIds = (wallets as any[]).map((w) => String(w.business));

    const [businesses, unreleasedRows, ledgerRows, orders] = await Promise.all([
      this.businessModel
        .find({ _id: { $in: businessIds.filter((id) => Types.ObjectId.isValid(id)) } })
        .select('business_name')
        .lean(),
      this.earningModel.aggregate([
        { $match: { released: false } },
        { $group: { _id: { $toString: '$business' }, net: { $sum: { $ifNull: ['$net_amount', 0] } } } },
      ]),
      this.transactionModel.aggregate([
        { $match: { wallet: { $in: walletForms } } },
        {
          $group: {
            _id: { wallet: { $toString: '$wallet' }, type: '$type', status: '$status' },
            amount: { $sum: { $ifNull: ['$amount', 0] } },
          },
        },
      ]),
      this.orderModel
        .find({ createdAt: { $gte: range.start, $lt: range.end }, payment_status: 'paid' })
        .select('reference status payment_status vendor_earnings platform_commission')
        .limit(5000)
        .lean(),
    ]);

    const names = new Map((businesses as any[]).map((b) => [String(b._id), b.business_name]));
    const unreleased = new Map((unreleasedRows as any[]).map((r) => [String(r._id), num(r.net)]));

    const ledger = new Map<string, LedgerSums>();
    for (const r of ledgerRows as any[]) {
      const key = String(r._id.wallet);
      const sums = ledger.get(key) ?? { fund: 0, credit: 0, debit: 0, refund: 0 };
      const { type, status } = r._id;
      const amount = num(r.amount);
      if (type === 'fund' && status === 'success') sums.fund += amount;
      else if (type === 'credit' && status === 'success') sums.credit += amount;
      // The wallet is debited when a withdrawal is requested; a failed
      // transfer is marked failed and credited back.
      else if (type === 'debit' && (status === 'success' || status === 'pending')) sums.debit += amount;
      else if (type === 'refund' && status === 'success') sums.refund += amount;
      ledger.set(key, sums);
    }

    const orderIds = (orders as any[]).map((o) => o._id);
    const [rowsByOrder, released] = await Promise.all([
      this.earningModel.aggregate([
        { $match: { order: { $in: orderIds } } },
        {
          $group: {
            _id: '$order',
            rows: { $sum: 1 },
            net: { $sum: { $ifNull: ['$net_amount', 0] } },
            commission: { $sum: { $ifNull: ['$commission', 0] } },
          },
        },
      ]),
      this.earningModel
        .find({ released: true, net_amount: { $gt: 0 }, released_at: { $gte: range.start, $lt: range.end } })
        .select('_id')
        .limit(20000)
        .lean(),
    ]);
    const rowSums = new Map((rowsByOrder as any[]).map((r) => [String(r._id), r]));

    const releasedIds = (released as any[]).map((e) => String(e._id));
    const credited = releasedIds.length
      ? await this.transactionModel
          .find({ type: 'credit', 'metadata.earning_id': { $in: releasedIds } })
          .select('metadata.earning_id')
          .lean()
      : [];
    const creditedIds = new Set((credited as any[]).map((t) => String(t.metadata?.earning_id)));

    const tally = tallyVendorMoney({
      wallets: (wallets as any[]).map((w) => ({
        wallet_id: String(w._id),
        business_id: String(w.business),
        business_name: names.get(String(w.business)) ?? null,
        balance: num(w.balance),
        pending_balance: num(w.pending_balance),
        owed_balance: num(w.owed_balance),
      })),
      unreleased,
      ledger,
      orders: (orders as any[]).map((o): TallyOrder => {
        const s = rowSums.get(String(o._id));
        return {
          order_id: String(o._id),
          reference: o.reference,
          status: o.status,
          payment_status: o.payment_status,
          vendor_earnings: num(o.vendor_earnings),
          platform_commission: num(o.platform_commission),
          rows: num(s?.rows),
          rows_net: num(s?.net),
          rows_commission: num(s?.commission),
        };
      }),
      releasedWithoutHistory: releasedIds.filter((id) => !creditedIds.has(id)).length,
    });

    const clean =
      !tally.pending_mismatch.length &&
      !tally.balance_mismatch.length &&
      !tally.order_totals_mismatch.length &&
      !tally.paid_without_earnings.length &&
      !tally.released_without_history;

    return {
      period: range.label,
      currency: 'NGN',
      data: {
        all_clear: clean,
        totals: {
          vendors_checked: tally.vendors_checked,
          orders_checked: tally.orders_checked,
          pending_mismatch: tally.pending_mismatch.length,
          balance_mismatch: tally.balance_mismatch.length,
          order_totals_mismatch: tally.order_totals_mismatch.length,
          paid_without_earnings: tally.paid_without_earnings.length,
          released_without_history: tally.released_without_history,
        },
        pending_mismatch: tally.pending_mismatch.slice(0, limit),
        balance_mismatch: tally.balance_mismatch.slice(0, limit),
        order_totals_mismatch: tally.order_totals_mismatch.slice(0, limit),
        paid_without_earnings: tally.paid_without_earnings.slice(0, limit),
        note:
          'Wallet checks are all-time; order checks cover paid orders created in the period. A positive balance difference means the wallet holds more than its history explains. Before 1 Nov 2026, money taken back after payout for returns, dispute refunds and late penalties wrote no history entry, and order totals were only reset on a full cancellation, so older vendors and orders can show differences from that alone.',
      },
    };
  }

  /** One vendor: which records cause its money differences. */
  private async explainVendorMoneyFor(args: any) {
    const pick = await this.findBusiness(String(args.business ?? ''));
    if ('none' in pick) return { error: `No vendor matching "${args.business}".` };
    if ('ambiguous' in pick) return { error: `Several vendors match: ${pick.ambiguous.join(', ')}. Which one?` };
    const b: any = pick.match;
    const bid = String(b._id);
    const idForms = [b._id, bid];
    const num = (v: any) => Number(v) || 0;

    const wallet: any = await this.walletModel
      .findOne({ business: { $in: idForms } })
      .select('balance pending_balance owed_balance')
      .lean();
    if (!wallet) return { error: `${b.business_name} has no wallet yet.` };
    const walletForms = [wallet._id, String(wallet._id)];

    const [earnings, linked, unlinked] = await Promise.all([
      this.earningModel
        .find({ business: { $in: idForms } })
        .select('order amount net_amount released released_at createdAt milestone')
        .populate('order', 'reference')
        .limit(20000)
        .lean(),
      this.transactionModel
        .find({ wallet: { $in: walletForms } })
        .select('reference type status amount channel createdAt metadata.earning_id metadata.payout_reversed metadata.clawback')
        .limit(20000)
        .lean(),
      // Payouts before the July ledger fix were logged without the wallet.
      this.transactionModel
        .find({ wallet: null, channel: 'payout', 'metadata.business_id': { $in: idForms } })
        .select('reference type status amount channel createdAt')
        .limit(5000)
        .lean(),
    ]);

    const tx = (t: any, unlinkedRow = false) => ({
      id: String(t._id),
      reference: t.reference ?? null,
      type: String(t.type),
      status: String(t.status),
      amount: num(t.amount),
      channel: t.channel ?? null,
      created_at: t.createdAt ?? null,
      earning_id: t.metadata?.earning_id ? String(t.metadata.earning_id) : null,
      payout_reversed: t.metadata?.payout_reversed === true,
      clawback: t.metadata?.clawback === true,
      unlinked: unlinkedRow,
    });

    const explanation = explainVendorMoney({
      wallet: {
        balance: num(wallet.balance),
        pending_balance: num(wallet.pending_balance),
        owed_balance: num(wallet.owed_balance),
      },
      earnings: (earnings as any[]).map((e) => ({
        id: String(e._id),
        order: e.order?.reference ?? (e.order ? String(e.order) : null),
        amount: num(e.amount),
        net_amount: num(e.net_amount),
        released: !!e.released,
        released_at: e.released_at ?? null,
        created_at: e.createdAt ?? null,
        milestone: e.milestone ?? null,
      })),
      transactions: [
        ...(linked as any[]).map((t) => tx(t)),
        ...(unlinked as any[]).map((t) => tx(t, true)),
      ],
    });

    return {
      currency: 'NGN',
      data: {
        business: b.business_name,
        ...explanation,
        fixes: Object.values(MONEY_FIXES),
        note:
          'accounts_for is signed: positive means the wallet holds more than its records, negative less. balance_unexplained is what no known cause covers; near zero, with every cause before_fix, means the difference is left over from bugs already fixed and current code is not adding to it. Pending should always equal the unreleased earnings. This only reads; nothing was changed.',
      },
    };
  }

  // ── Search gaps ───────────────────────────────────────────────────────────

  private async searchGapsReport(args: any) {
    const range = resolveRange((args ?? {}) as RangeArgs);
    const limit = this.clamp(args.limit, 15, 40);
    const rows = await this.eventModel
      .find({ eventType: 'search', timestamp: { $gte: range.start, $lt: range.end }, 'metadata.query': { $exists: true, $ne: '' } })
      .select('metadata.query metadata.results timestamp')
      .limit(20000)
      .lean();
    const report = searchGaps((rows as any[]).map((e) => ({ query: e.metadata?.query, results: typeof e.metadata?.results === 'number' ? e.metadata.results : null, at: e.timestamp })));
    return {
      period: range.label,
      data: {
        searches: report.searches,
        distinct_terms: report.terms,
        gaps: report.gaps.slice(0, limit),
        most_searched: report.top.slice(0, limit),
        note: 'A gap is a term searched at least twice where half or more of the recorded searches returned nothing. Searches before result counts were recorded are counted in "searches" but not judged.',
      },
    };
  }

  // ── Catalogue quality ─────────────────────────────────────────────────────

  private async catalogueQuality(args: any) {
    const limit = this.clamp(args.limit, 15, 40);
    const now = new Date();
    const products = await this.productModel
      .find({ status: 'active' })
      .select('kind status business base_price size_guide createdAt clothing fabric accessory')
      .limit(5000)
      .lean();
    const issueCounts: Record<string, number> = {};
    const perVendor = new Map<string, { products: number; with_issues: number; issues: number }>();
    let withIssues = 0;
    for (const p of products as any[]) {
      const issues = catalogueIssues(p, now).filter((i) => i !== 'no_views_30d' && i !== 'stale_draft');
      const v = perVendor.get(String(p.business)) ?? { products: 0, with_issues: 0, issues: 0 };
      v.products++;
      if (issues.length) {
        withIssues++;
        v.with_issues++;
        v.issues += issues.length;
        for (const i of issues) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
      }
      perVendor.set(String(p.business), v);
    }
    const names = await this.businessNames([...perVendor.keys()]);
    const vendors = [...perVendor.entries()]
      .filter(([, v]) => v.products >= 3 && v.with_issues > 0)
      .map(([id, v]) => ({ business_id: id, vendor: names.get(id) ?? id, products: v.products, with_issues: v.with_issues, share: Math.round((v.with_issues / v.products) * 100) }))
      .sort((a, b) => b.share - a.share || b.with_issues - a.with_issues)
      .slice(0, limit);
    return {
      snapshot: now.toISOString(),
      data: {
        active_products: products.length,
        with_issues: withIssues,
        complete_share: products.length ? Math.round(((products.length - withIssues) / products.length) * 100) : null,
        issue_counts: Object.fromEntries(Object.entries(issueCounts).map(([k, n]) => [CATALOGUE_ISSUE_LABEL[k] ?? k, n]).sort((a, b) => (b[1] as number) - (a[1] as number))),
        vendors_most_incomplete: vendors,
        note: 'Audience, colours and sizes are what search and the AI stylist match on; a product missing them is rarely shown. nudge_vendor sends a vendor the fix-your-listings notification.',
      },
    };
  }

  // ── Vendor health ─────────────────────────────────────────────────────────

  private async vendorHealthReport(args: any) {
    const range = resolveRange((args ?? {}) as RangeArgs);
    const window = { createdAt: { $gte: range.start, $lt: range.end } };

    let only: Types.ObjectId | null = null;
    if (args.business) {
      const pick = await this.findBusiness(String(args.business));
      if ('none' in pick) return { error: `No vendor matching "${args.business}".` };
      if ('ambiguous' in pick) return { error: `Several vendors match: ${pick.ambiguous.join(', ')}. Which one?` };
      only = (pick.match as any)._id;
    }

    const [orderRows, disputeRows, returnRows, ratingRows] = await Promise.all([
      this.orderModel.aggregate([
        { $match: { ...window, status: { $ne: 'pending' } } },
        { $unwind: '$shipments' },
        {
          $group: {
            _id: '$shipments.business',
            orders: { $sum: 1 },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            shipped: { $sum: { $cond: [{ $ifNull: ['$shipments.shipped_at', false] }, 1, 0] } },
            late: { $sum: { $cond: [{ $and: [{ $ifNull: ['$shipments.shipped_at', false] }, { $ifNull: ['$shipments.fulfillment_deadline', false] }, { $gt: ['$shipments.shipped_at', '$shipments.fulfillment_deadline'] }] }, 1, 0] } },
          },
        },
      ]),
      this.disputeModel.aggregate([{ $match: window }, { $group: { _id: '$business', n: { $sum: 1 } } }]),
      this.returnModel.aggregate([{ $match: window }, { $group: { _id: '$business', n: { $sum: 1 } } }]),
      this.productModel.aggregate([
        { $match: { status: 'active', total_ratings: { $gt: 0 } } },
        { $group: { _id: '$business', weighted: { $sum: { $multiply: ['$average_rating', '$total_ratings'] } }, n: { $sum: '$total_ratings' } } },
      ]),
    ]);
    const disputes = new Map(disputeRows.map((r: any) => [String(r._id), r.n]));
    const returns = new Map(returnRows.map((r: any) => [String(r._id), r.n]));
    const ratings = new Map(ratingRows.map((r: any) => [String(r._id), { rating: r.n ? Math.round((r.weighted / r.n) * 10) / 10 : null, n: r.n }]));
    const names = await this.businessNames(orderRows.map((r: any) => r._id));

    const inputs: VendorHealthInput[] = orderRows
      .filter((r: any) => r._id)
      .map((r: any) => {
        const id = String(r._id);
        return {
          business_id: id,
          name: names.get(id) ?? id,
          orders: r.orders,
          shipped: r.shipped,
          late: r.late,
          cancelled: r.cancelled,
          disputes: disputes.get(id) ?? 0,
          returns: returns.get(id) ?? 0,
          rating: ratings.get(id)?.rating ?? null,
          rating_count: ratings.get(id)?.n ?? 0,
        };
      });
    const report = vendorHealth(inputs);
    const strip = (r: any) => ({ business_id: r.business_id, vendor: r.name, orders: r.orders, late_rate: r.late_rate, cancel_rate: r.cancel_rate, dispute_rate: r.dispute_rate, return_rate: r.return_rate, rating: r.rating, flags: r.flags });

    if (only) {
      const row = report.rows.find((r) => r.business_id === String(only));
      return {
        period: range.label,
        data: {
          vendor: row ? strip(row) : { business_id: String(only), vendor: names.get(String(only)) ?? null, orders: 0, note: 'No orders in this period.' },
          platform_medians: report.medians,
          vendors_assessed: report.vendors_assessed,
        },
      };
    }
    return {
      period: range.label,
      data: {
        vendors_with_orders: report.rows.length,
        vendors_assessed: report.vendors_assessed,
        min_orders_to_assess: report.min_orders,
        platform_medians: report.medians,
        flagged: report.flagged.slice(0, 15).map(strip),
        note: 'Rates are per order (per shipped order for lateness). Compare a vendor to the medians, not to zero.',
      },
    };
  }
}
