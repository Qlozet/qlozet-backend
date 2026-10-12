import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LlmToolDef } from '../llm/llm-provider.interface';
import { ASSISTANT_ACTION_TTL_HOURS, AssistantAction, AssistantActionCard, toCard } from '../schema/action.schema';
import { AssistantConversation } from '../schema/conversation.schema';
import { ProductService } from '../../products/products.service';
import { ProductModerationStatus } from '../../products/enums/product-moderation.enum';
import { BusinessService } from '../../business/business.service';
import { BusinessStatus } from '../../business/schemas/business.schema';
import { TicketService } from '../../ticket/ticket.service';
import { DisputesService } from '../../disputes/disputes.service';
import { DisputeResolution } from '../../disputes/dto/resolve-dispute.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { VendorRecipientsService } from '../../notifications/vendor-recipients.service';
import { VendorRole } from '../../ums/schemas/role.schema';
import { NotificationCategory, NotificationType } from '../../notifications/schemas/notification.schema';
import { escapeRegex, naira, pickByName, productName } from './vendor-actions.helpers';
import {
  ADMIN_ACTION_KINDS,
  AdminActionKind,
  isAdminActionKind,
  permittedAdminActionKinds,
  validateRefundAmount,
} from './admin-actions.helpers';

type Prepared = { title: string; summary: string; details: { label: string; value: string }[]; params: Record<string, any> };
type PrepareOutcome = Prepared | { error: string };

const KIND_HELP: Record<AdminActionKind, string> = {
  approve_product: 'approve_product: product (name or id) - lists it in the storefront.',
  reject_product: 'reject_product: product (name or id), reason (required; the vendor reads it) - removes it from the storefront.',
  decide_vendor_application: "decide_vendor_application: business (name or id), decision (approve | reject | request_changes), message (required unless approving; the vendor reads it).",
  assign_ticket: 'assign_ticket: ticket_id, assignee ("me", or a team member\'s name or id).',
  reply_to_ticket: 'reply_to_ticket: ticket_id, reply (the text, as the admin), mark_resolved (optional).',
  resolve_dispute: 'resolve_dispute: dispute (id or order reference), resolution (full_refund | partial_refund | release_to_vendor), refund_amount (for partial), notes.',
  nudge_vendor: 'nudge_vendor: business (name or id), topic (listings | fulfilment | general), message (what you want them to do, in plain words; the vendor reads it) - sends an in-app notification to the right people at the vendor.',
};

/**
 * The admin assistant's write path, built on the same two halves as the
 * vendor's: propose() validates against real records and stores a card the
 * model can only describe; confirm() is the admin's own tap, scoped to the
 * admin who was offered the card, executing through the same services the
 * console uses. Which kinds exist for an admin follows the permission
 * modules of their role, so a role that cannot see disputes is never
 * offered "resolve dispute".
 */
@Injectable()
export class AdminActionsService {
  private readonly logger = new Logger(AdminActionsService.name);

  constructor(
    @InjectModel(AssistantAction.name) private readonly actionModel: Model<AssistantAction>,
    @InjectModel(AssistantConversation.name) private readonly conversationModel: Model<AssistantConversation>,
    @InjectModel('Product') private readonly productModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
    @InjectModel('User') private readonly userModel: Model<any>,
    @InjectModel('Ticket') private readonly ticketModel: Model<any>,
    @InjectModel('Dispute') private readonly disputeModel: Model<any>,
    @InjectModel('Order') private readonly orderModel: Model<any>,
    private readonly productService: ProductService,
    private readonly businessService: BusinessService,
    private readonly ticketService: TicketService,
    private readonly disputesService: DisputesService,
    private readonly notifications: NotificationsService,
    private readonly vendorRecipients: VendorRecipientsService,
  ) {}

  /** Empty when the role may prepare nothing - then the model never hears of actions. */
  toolDefs(modules: Set<string> | null): LlmToolDef[] {
    const kinds = permittedAdminActionKinds(modules);
    if (!kinds.length) return [];
    return [
      {
        name: 'propose_action',
        description:
          'PREPARE an action for the admin to confirm. Nothing happens until they tap Confirm on the card this shows them - never say it is done. Get the exact record first (search, get_work_queue, get_ticket, get_dispute, get_vendor). Kinds available to this admin and the fields each needs: ' +
          kinds.map((k) => KIND_HELP[k]).join(' ') +
          ' If the result is an error, ask the admin the question it raises instead of guessing.',
        input_schema: {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: { type: 'string', enum: kinds },
            product: { type: 'string' },
            reason: { type: 'string' },
            business: { type: 'string' },
            decision: { type: 'string', enum: ['approve', 'reject', 'request_changes'] },
            message: { type: 'string' },
            ticket_id: { type: 'string' },
            assignee: { type: 'string', description: '"me", or a team member\'s name or id.' },
            reply: { type: 'string' },
            mark_resolved: { type: 'boolean' },
            dispute: { type: 'string', description: 'Dispute id or order reference.' },
            resolution: { type: 'string', enum: ['full_refund', 'partial_refund', 'release_to_vendor'] },
            refund_amount: { type: 'number' },
            notes: { type: 'string' },
            topic: { type: 'string', enum: ['listings', 'fulfilment', 'general'] },
          },
        },
      },
    ];
  }

  // ── Propose ───────────────────────────────────────────────────────────────

  async propose(
    adminId: string,
    modules: Set<string> | null,
    conversationId: string | null,
    input: any,
  ): Promise<{ card: AssistantActionCard } | { error: string }> {
    if (!Types.ObjectId.isValid(adminId)) return { error: 'Missing admin context.' };
    const kind = String(input?.kind ?? '');
    if (!isAdminActionKind(kind)) return { error: `Unknown action kind "${kind}". Kinds: ${ADMIN_ACTION_KINDS.join(', ')}.` };
    if (!permittedAdminActionKinds(modules).includes(kind)) return { error: `Your role cannot ${kind.replace(/_/g, ' ')}.` };

    let prepared: PrepareOutcome;
    try {
      switch (kind) {
        case 'approve_product': prepared = await this.prepareModerate(input, ProductModerationStatus.APPROVED); break;
        case 'reject_product': prepared = await this.prepareModerate(input, ProductModerationStatus.REJECTED); break;
        case 'decide_vendor_application': prepared = await this.prepareDecideVendor(input); break;
        case 'assign_ticket': prepared = await this.prepareAssignTicket(input, adminId); break;
        case 'reply_to_ticket': prepared = await this.prepareReplyToTicket(input); break;
        case 'resolve_dispute': prepared = await this.prepareResolveDispute(input); break;
        case 'nudge_vendor': prepared = await this.prepareNudgeVendor(input); break;
      }
    } catch (err: any) {
      this.logger.warn(`admin propose ${kind} failed: ${err?.message}`);
      return { error: err?.message ?? 'Could not prepare that action.' };
    }
    if ('error' in prepared) return prepared;

    const doc = await this.actionModel.create({
      business: null,
      admin_user: new Types.ObjectId(adminId),
      conversation: conversationId && Types.ObjectId.isValid(conversationId) ? new Types.ObjectId(conversationId) : null,
      kind,
      ...prepared,
      status: 'proposed',
      expires_at: new Date(Date.now() + ASSISTANT_ACTION_TTL_HOURS * 3_600_000),
    });
    return { card: toCard(doc) };
  }

  private isId(s: string) {
    return Types.ObjectId.isValid(s) && String(new Types.ObjectId(s)) === s;
  }

  private async findProduct(typed: string) {
    const t = typed.trim();
    if (!t) return { none: true } as const;
    if (this.isId(t)) {
      const p = await this.productModel.findById(t).lean();
      return p ? ({ match: p } as const) : ({ none: true } as const);
    }
    const rx = new RegExp(escapeRegex(t), 'i');
    const rows: any[] = await this.productModel
      .find({ status: { $ne: 'archived' }, $or: [{ 'clothing.name': rx }, { 'fabric.name': rx }, { 'accessory.name': rx }] })
      .populate({ path: 'business', select: 'business_name' })
      .limit(20)
      .lean();
    // Two vendors can sell a "Black Kaftan": name them with the vendor so the admin can say which.
    return pickByName(rows, t, (p: any) => productName(p)) as { match: any } | { ambiguous: string[] } | { none: true };
  }

  private async prepareModerate(input: any, decision: ProductModerationStatus): Promise<PrepareOutcome> {
    const typed = String(input?.product ?? '').trim();
    if (!typed) return { error: 'Which product? Give product (name or id).' };
    const pick = await this.findProduct(typed);
    if ('none' in pick) return { error: `No product matching "${typed}".` };
    if ('ambiguous' in pick) {
      const rows: any[] = await this.productModel.find({ $or: [{ 'clothing.name': new RegExp(escapeRegex(typed), 'i') }, { 'fabric.name': new RegExp(escapeRegex(typed), 'i') }, { 'accessory.name': new RegExp(escapeRegex(typed), 'i') }] }).populate({ path: 'business', select: 'business_name' }).limit(10).lean();
      return { error: `Several products match "${typed}": ${rows.map((p) => `${productName(p)} (${p.business?.business_name ?? 'unknown vendor'}, id ${p._id})`).join('; ')}. Which one? Use the id.` };
    }
    const p: any = pick.match;
    const business: any = p.business && typeof p.business === 'object' ? p.business : await this.businessModel.findById(p.business).select('business_name').lean();
    const current = p.moderation?.status ?? 'pending';
    const reason = String(input?.reason ?? '').trim();
    if (decision === ProductModerationStatus.REJECTED && !reason) return { error: 'A reason is required to reject a product - the vendor reads it. Give reason.' };
    if (current === decision) return { error: `"${productName(p)}" is already ${decision}.` };

    const verb = decision === ProductModerationStatus.APPROVED ? 'Approve' : 'Reject';
    return {
      title: `${verb} "${productName(p)}"`,
      summary:
        decision === ProductModerationStatus.APPROVED
          ? `Approve this listing. It becomes visible to shoppers (if the vendor has it active) and the vendor is told.`
          : `Reject this listing. It is removed from the storefront and the vendor is told why.`,
      details: [
        { label: 'Product', value: productName(p) },
        { label: 'Vendor', value: business?.business_name ?? 'unknown' },
        { label: 'Kind', value: String(p.kind) },
        { label: 'Price', value: naira(Number(p.base_price) || 0) },
        { label: 'Moderation', value: `${current} → ${decision}` },
        ...(reason ? [{ label: 'Reason', value: reason.slice(0, 300) }] : []),
      ],
      params: { product_id: String(p._id), decision, reason: reason || null },
    };
  }

  private async findBusiness(typed: string) {
    const t = typed.trim();
    if (!t) return { none: true } as const;
    if (this.isId(t)) {
      const b = await this.businessModel.findById(t).lean();
      return b ? ({ match: b } as const) : ({ none: true } as const);
    }
    const rx = new RegExp(escapeRegex(t), 'i');
    const rows: any[] = await this.businessModel.find({ $or: [{ business_name: rx }, { business_email: rx }] }).limit(20).lean();
    return pickByName(rows, t, (b: any) => b.business_name ?? '') as { match: any } | { ambiguous: string[] } | { none: true };
  }

  private async prepareDecideVendor(input: any): Promise<PrepareOutcome> {
    const typed = String(input?.business ?? '').trim();
    if (!typed) return { error: 'Which vendor? Give business (name or id).' };
    const decision = String(input?.decision ?? '').trim();
    if (!['approve', 'reject', 'request_changes'].includes(decision)) return { error: 'decision must be approve, reject or request_changes.' };
    const message = String(input?.message ?? '').trim();
    if (decision !== 'approve' && !message) return { error: 'Say what the vendor needs to know - give message. They only ever see this text.' };

    const pick = await this.findBusiness(typed);
    if ('none' in pick) return { error: `No vendor matching "${typed}".` };
    if ('ambiguous' in pick) return { error: `Several vendors match: ${pick.ambiguous.join(', ')}. Which one?` };
    const b: any = pick.match;
    if (decision === 'approve' && ['approved', 'verified'].includes(b.status)) return { error: `${b.business_name} is already ${b.status}.` };
    if (decision === 'reject' && b.status === 'rejected') return { error: `${b.business_name} is already rejected.` };

    const label = decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Request changes from';
    return {
      title: `${label} ${b.business_name}`,
      summary:
        decision === 'approve'
          ? `Approve this vendor. Their store goes live and their products can be seen; they are notified.`
          : decision === 'reject'
            ? `Reject this application. The store stays offline; they are notified.`
            : `Ask the vendor to fix something before a decision. They get your message and one more verification attempt.`,
      details: [
        { label: 'Vendor', value: b.business_name },
        { label: 'Email', value: b.business_email ?? 'unknown' },
        { label: 'Location', value: [b.city, b.state].filter(Boolean).join(', ') || 'not set' },
        { label: 'Status', value: `${b.status} → ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'action required'}` },
        { label: 'Applied', value: b.createdAt ? new Date(b.createdAt).toDateString() : 'unknown' },
        ...(message ? [{ label: 'Message to vendor', value: message.slice(0, 300) }] : []),
      ],
      params: { business_id: String(b._id), business_name: b.business_name, decision, message: message || null },
    };
  }

  private async loadOpenTicket(
    id: string,
  ): Promise<{ error: string } | { ticket: any; from: string; assignee: string | null }> {
    if (!this.isId(id)) return { error: 'Give a valid ticket_id.' };
    const t: any = await this.ticketModel.findById(id).lean();
    if (!t) return { error: 'No such ticket.' };
    const [b, c, a] = await Promise.all([
      t.business ? this.businessModel.findById(t.business).select('business_name').lean() : null,
      t.customer ? this.userModel.findById(t.customer).select('full_name').lean() : null,
      t.assigned_to ? this.userModel.findById(t.assigned_to).select('full_name').lean() : null,
    ]);
    const from = (b as any)?.business_name ? `vendor ${(b as any).business_name}` : (c as any)?.full_name ? `customer ${(c as any).full_name}` : 'unknown';
    return { ticket: t, from, assignee: (a as any)?.full_name ?? null };
  }

  private async prepareAssignTicket(input: any, adminId: string): Promise<PrepareOutcome> {
    const loaded = await this.loadOpenTicket(String(input?.ticket_id ?? ''));
    if ('error' in loaded) return loaded;
    const { ticket, from, assignee } = loaded;
    if (['resolved', 'closed'].includes(ticket.status)) return { error: `Ticket is ${ticket.status}; nothing to assign.` };

    const typed = String(input?.assignee ?? 'me').trim();
    let target: any;
    if (!typed || typed.toLowerCase() === 'me') target = await this.userModel.findById(adminId).select('full_name').lean();
    else if (this.isId(typed)) target = await this.userModel.findOne({ _id: typed, type: 'platform' }).select('full_name').lean();
    else {
      const rx = new RegExp(escapeRegex(typed), 'i');
      const rows: any[] = await this.userModel.find({ type: 'platform', $or: [{ full_name: rx }, { email: rx }] }).select('full_name email').limit(10).lean();
      const pick = pickByName(rows, typed, (u: any) => u.full_name ?? u.email ?? '');
      if ('ambiguous' in pick) return { error: `Several team members match "${typed}": ${pick.ambiguous.join(', ')}. Which one?` };
      if ('none' in pick) return { error: `No team member matching "${typed}".` };
      target = pick.match;
    }
    if (!target) return { error: `No team member matching "${typed}".` };
    if (String(ticket.assigned_to ?? '') === String(target._id)) return { error: `This ticket is already assigned to ${target.full_name}.` };

    return {
      title: `Assign ticket to ${target.full_name}`,
      summary: `Assign this ${ticket.issue_type} ticket from ${from} to ${target.full_name} and mark it in progress.`,
      details: [
        { label: 'Ticket', value: String(ticket._id) },
        { label: 'Issue', value: String(ticket.issue_type) },
        { label: 'From', value: from },
        { label: 'Assignee', value: `${assignee ?? 'unassigned'} → ${target.full_name}` },
      ],
      params: { ticket_id: String(ticket._id), assignee_id: String(target._id), assignee_name: target.full_name },
    };
  }

  private async prepareReplyToTicket(input: any): Promise<PrepareOutcome> {
    const loaded = await this.loadOpenTicket(String(input?.ticket_id ?? ''));
    if ('error' in loaded) return loaded;
    const { ticket, from } = loaded;
    if (ticket.status === 'closed') return { error: 'This ticket is closed.' };
    const reply = String(input?.reply ?? '').replace(/\s+/g, ' ').trim();
    if (reply.length < 5) return { error: 'What should the reply say? Give reply.' };
    if (reply.length > 2000) return { error: 'The reply is too long (max 2000 characters).' };
    const markResolved = input?.mark_resolved === true;
    return {
      title: `Reply to ${from}'s ticket`,
      summary: `Send this reply on the ${ticket.issue_type} ticket${markResolved ? ' and mark the ticket resolved' : ''}. The other side is notified.`,
      details: [
        { label: 'Ticket', value: String(ticket._id) },
        { label: 'Issue', value: String(ticket.issue_type) },
        { label: 'Reply', value: reply.length > 400 ? `${reply.slice(0, 400)}…` : reply },
        ...(markResolved ? [{ label: 'Then', value: 'mark resolved' }] : []),
      ],
      params: { ticket_id: String(ticket._id), reply, mark_resolved: markResolved },
    };
  }

  private async prepareResolveDispute(input: any): Promise<PrepareOutcome> {
    const key = String(input?.dispute ?? '').trim();
    if (!key) return { error: 'Which dispute? Give dispute (id or order reference).' };
    const d: any = this.isId(key)
      ? await this.disputeModel.findById(key).lean()
      : await this.disputeModel.findOne({ order_reference: new RegExp(`^${escapeRegex(key)}$`, 'i'), status: { $in: ['open', 'under_review'] } }).sort({ createdAt: -1 }).lean();
    if (!d) return { error: `No open dispute for "${key}".` };
    if (!['open', 'under_review'].includes(d.status)) return { error: `This dispute is already ${d.status}.` };
    const resolution = String(input?.resolution ?? '').trim();
    if (!(Object.values(DisputeResolution) as string[]).includes(resolution)) return { error: 'resolution must be full_refund, partial_refund or release_to_vendor.' };

    const [order, b, c] = await Promise.all([
      this.orderModel.findById(d.order).select('reference total').lean(),
      this.businessModel.findById(d.business).select('business_name').lean(),
      this.userModel.findById(d.customer).select('full_name').lean(),
    ]);
    const total = Number((order as any)?.total) || 0;
    const amount = validateRefundAmount(resolution, input?.refund_amount, total);
    if ('error' in amount) return amount;
    const notes = String(input?.notes ?? '').trim();

    const what =
      resolution === 'full_refund' ? `refund the customer in full${amount.amount ? ` (${naira(amount.amount)})` : ''}`
      : resolution === 'partial_refund' ? `refund the customer ${naira(amount.amount ?? 0)} of ${naira(total)}`
      : `release the money to the vendor`;
    return {
      title: `Resolve dispute on ${d.order_reference}: ${resolution.replace(/_/g, ' ')}`,
      summary: `Close this dispute and ${what}. Both sides are notified; this cannot be undone from the console.`,
      details: [
        { label: 'Order', value: String(d.order_reference) },
        { label: 'Customer', value: (c as any)?.full_name ?? 'unknown' },
        { label: 'Vendor', value: (b as any)?.business_name ?? 'unknown' },
        { label: 'Reason', value: String(d.reason).replace(/_/g, ' ') },
        { label: 'Raised by', value: d.initiated_by ?? 'customer' },
        { label: 'Vendor responded', value: d.vendor_response ? 'yes' : 'no' },
        { label: 'Order total', value: naira(total) },
        { label: 'Resolution', value: resolution.replace(/_/g, ' ') },
        ...(amount.amount !== null ? [{ label: 'Refund', value: naira(amount.amount) }] : []),
        ...(notes ? [{ label: 'Notes', value: notes.slice(0, 300) }] : []),
      ],
      params: { dispute_id: String(d._id), order_reference: d.order_reference, resolution, refund_amount: amount.amount, notes: notes || null },
    };
  }

  private async prepareNudgeVendor(input: any): Promise<PrepareOutcome> {
    const typed = String(input?.business ?? '').trim();
    if (!typed) return { error: 'Which vendor? Give business (name or id).' };
    const topic = ['listings', 'fulfilment', 'general'].includes(input?.topic) ? input.topic : 'general';
    const message = String(input?.message ?? '').replace(/\s+/g, ' ').trim();
    if (message.length < 10) return { error: 'What should the vendor do? Give message (at least 10 characters) - they read it as written.' };
    if (message.length > 600) return { error: 'The message is too long (max 600 characters).' };
    const pick = await this.findBusiness(typed);
    if ('none' in pick) return { error: `No vendor matching "${typed}".` };
    if ('ambiguous' in pick) return { error: `Several vendors match: ${pick.ambiguous.join(', ')}. Which one?` };
    const b: any = pick.match;
    const roles = topic === 'listings' ? ['operations', 'marketing'] : topic === 'fulfilment' ? ['operations', 'tailor'] : ['operations'];
    const recipients = await this.vendorRecipients.resolve(String(b._id), roles as VendorRole[]);
    const title = topic === 'listings' ? 'A note from Qlozet about your listings' : topic === 'fulfilment' ? 'A note from Qlozet about your orders' : 'A note from Qlozet';
    return {
      title: `Nudge ${b.business_name}`,
      summary: `Send ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} at ${b.business_name} an in-app notification titled "${title}" with your message. They can open the assistant from it.`,
      details: [
        { label: 'Vendor', value: b.business_name },
        { label: 'Topic', value: topic },
        { label: 'Recipients', value: `${recipients.length} (${roles.join(', ')} + owner)` },
        { label: 'Message', value: message.length > 300 ? `${message.slice(0, 300)}…` : message },
      ],
      params: { business_id: String(b._id), business_name: b.business_name, topic, title, message, recipient_ids: recipients.map((r: any) => String(r.userId)) },
    };
  }

  // ── Decide ────────────────────────────────────────────────────────────────

  async get(adminId: string, actionId: string): Promise<AssistantActionCard> {
    return toCard(await this.owned(adminId, actionId));
  }

  async cancel(adminId: string, actionId: string): Promise<AssistantActionCard> {
    const doc = await this.owned(adminId, actionId);
    if (doc.status !== 'proposed') throw new BadRequestException(`This action is already ${doc.status}.`);
    doc.status = 'cancelled';
    doc.decided_at = new Date();
    await doc.save();
    await this.syncEmbedded(doc);
    return toCard(doc);
  }

  async confirm(adminId: string, actionId: string): Promise<AssistantActionCard> {
    const doc = await this.owned(adminId, actionId);
    if (doc.status !== 'proposed') throw new BadRequestException(`This action is already ${doc.status}.`);
    if (doc.expires_at.getTime() < Date.now()) {
      doc.status = 'expired';
      doc.decided_at = new Date();
      await doc.save();
      await this.syncEmbedded(doc);
      throw new BadRequestException('This action has expired. Ask the assistant to prepare it again.');
    }
    doc.confirmed_by = new Types.ObjectId(adminId);
    doc.decided_at = new Date();
    try {
      const { result, text } = await this.execute(doc, adminId);
      doc.status = 'executed';
      doc.result = result;
      doc.result_text = text;
    } catch (err: any) {
      this.logger.warn(`admin action ${doc.kind} ${doc._id} failed: ${err?.message}`);
      doc.status = 'failed';
      const msg = err?.response?.message ?? err?.message ?? 'Something went wrong.';
      doc.error = Array.isArray(msg) ? msg.join('; ') : String(msg);
    }
    await doc.save();
    await this.syncEmbedded(doc);
    return toCard(doc);
  }

  private async execute(doc: AssistantAction, adminId: string): Promise<{ result: Record<string, any>; text: string }> {
    const p = doc.params || {};
    switch (doc.kind as AdminActionKind) {
      case 'approve_product':
      case 'reject_product': {
        await this.productService.adminModerate(p.product_id, p.decision, adminId, p.reason ?? undefined);
        const product: any = await this.productModel.findById(p.product_id).lean();
        return { result: { product_id: p.product_id, decision: p.decision }, text: `${productName(product)} ${p.decision}` };
      }
      case 'decide_vendor_application': {
        if (p.decision === 'request_changes') {
          await this.businessService.decideVerification(p.business_id, 'action_required', p.message);
          return { result: { business_id: p.business_id, decision: 'action_required' }, text: `${p.business_name}: changes requested` };
        }
        const status = p.decision === 'approve' ? BusinessStatus.APPROVED : BusinessStatus.REJECTED;
        await this.businessService.updateBusinessStatus(p.business_id, status);
        return { result: { business_id: p.business_id, status }, text: `${p.business_name} ${status}` };
      }
      case 'assign_ticket': {
        await this.ticketService.assign(p.ticket_id, { support_team_id: p.assignee_id }, adminId);
        return { result: { ticket_id: p.ticket_id, assignee_id: p.assignee_id }, text: `Ticket assigned to ${p.assignee_name}` };
      }
      case 'reply_to_ticket': {
        await this.ticketService.createReply(new Types.ObjectId(p.ticket_id), new Types.ObjectId(adminId), { message: p.reply });
        if (p.mark_resolved) await this.ticketService.update(p.ticket_id, { status: 'resolved' } as any, adminId);
        return { result: { ticket_id: p.ticket_id, resolved: !!p.mark_resolved }, text: p.mark_resolved ? 'Reply sent and ticket marked resolved' : 'Reply sent' };
      }
      case 'resolve_dispute': {
        await this.disputesService.resolveDispute(p.dispute_id, adminId, {
          resolution: p.resolution,
          ...(p.refund_amount != null && p.resolution === 'partial_refund' ? { refund_amount: p.refund_amount } : {}),
          ...(p.notes ? { admin_notes: p.notes } : {}),
        } as any);
        return { result: { dispute_id: p.dispute_id, resolution: p.resolution, refund_amount: p.refund_amount }, text: `Dispute on ${p.order_reference} resolved: ${String(p.resolution).replace(/_/g, ' ')}` };
      }
      case 'nudge_vendor': {
        let sent = 0;
        for (const userId of p.recipient_ids as string[]) {
          try {
            await this.notifications.create({
              recipient: userId,
              recipient_business: p.business_id,
              category: NotificationCategory.SYSTEM,
              type: NotificationType.ANNOUNCEMENT,
              title: p.title,
              body: p.message,
              metadata: { from_admin: String(adminId), topic: p.topic, nudge: true },
              action_url: p.topic === 'listings' ? '/products' : p.topic === 'fulfilment' ? '/orders' : '/dashboard',
            } as any);
            sent++;
          } catch (err: any) {
            this.logger.warn(`nudge to ${userId} failed: ${err?.message}`);
          }
        }
        if (!sent) throw new Error('No notification could be sent.');
        return { result: { business_id: p.business_id, sent }, text: `Nudge sent to ${sent} ${sent === 1 ? 'person' : 'people'} at ${p.business_name}` };
      }
      default:
        throw new Error(`Unknown action kind ${doc.kind}`);
    }
  }

  private async syncEmbedded(doc: AssistantAction) {
    if (!doc.conversation) return;
    const id = String(doc._id);
    try {
      await this.conversationModel.updateOne(
        { _id: doc.conversation, 'messages.actions.action_id': id },
        { $set: { 'messages.$[m].actions.$[a].status': doc.status, 'messages.$[m].actions.$[a].result_text': doc.result_text ?? null, 'messages.$[m].actions.$[a].error': doc.error ?? null } },
        { arrayFilters: [{ 'm.actions.action_id': id }, { 'a.action_id': id }] },
      );
    } catch (err: any) {
      this.logger.warn(`Could not sync admin action ${id}: ${err?.message}`);
    }
  }

  /** Found, and offered to THIS admin. Someone else's card is a 404. */
  private async owned(adminId: string, actionId: string) {
    if (!Types.ObjectId.isValid(actionId) || !Types.ObjectId.isValid(adminId)) throw new NotFoundException('Action not found');
    const doc = await this.actionModel.findOne({ _id: new Types.ObjectId(actionId), admin_user: new Types.ObjectId(adminId) });
    if (!doc) throw new NotFoundException('Action not found');
    return doc;
  }
}
