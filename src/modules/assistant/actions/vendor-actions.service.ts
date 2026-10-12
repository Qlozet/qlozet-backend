import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import { LlmToolDef } from '../llm/llm-provider.interface';
import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_ACTION_TTL_HOURS,
  AssistantAction,
  AssistantActionCard,
  AssistantActionKind,
  toCard,
} from '../schema/action.schema';
import { AssistantConversation } from '../schema/conversation.schema';
import { OrderService } from '../../orders/orders.service';
import { BespokeService } from '../../bespoke/bespoke.service';
import { DiscountService } from '../../products/discount.service';
import { vendorItems, vendorTotal } from '../tools/vendor-ops.helpers';
import {
  buildDiscountDto,
  describeDiscount,
  DiscountRequest,
  escapeRegex,
  naira,
  pickByName,
  productName,
  resolveStockTarget,
  validateListingChange,
  ListingVocabulary,
} from './vendor-actions.helpers';

type Prepared = {
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  params: Record<string, any>;
};
type PrepareOutcome = Prepared | { error: string };

const MAX_PERCENT_OFF = 90;
const MAX_ORDERS_PER_ACTION = 20;

/**
 * The assistant's write path, split in two on purpose:
 *
 *   propose()  - called by the model through the propose_action tool. Checks
 *                the request against the vendor's real data, resolves names to
 *                ids, stores a proposed AssistantAction and returns the card.
 *                Writes nothing else. A bad request comes back as an error the
 *                model can read and ask about.
 *   confirm()  - called only by the vendor's own tap on that card, through an
 *                authenticated route scoped to their business. Executes via the
 *                same service methods the dashboard uses, so every rule those
 *                enforce still applies, and records the outcome.
 */
@Injectable()
export class VendorActionsService {
  private readonly logger = new Logger(VendorActionsService.name);

  constructor(
    @InjectModel(AssistantAction.name) private readonly actionModel: Model<AssistantAction>,
    @InjectModel(AssistantConversation.name) private readonly conversationModel: Model<AssistantConversation>,
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('Product') private readonly productModel: Model<any>,
    @InjectModel('BespokeQuote') private readonly quoteModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
    @InjectModel('SystemCategory') private readonly categoryModel: Model<any>,
    private readonly orderService: OrderService,
    private readonly bespokeService: BespokeService,
    private readonly discountService: DiscountService,
    private readonly events: EventEmitter2,
  ) {}

  toolDef(): LlmToolDef {
    return {
      name: 'propose_action',
      description:
        'PREPARE an action for the vendor to confirm. Nothing happens until they tap Confirm on the card this shows them - never say it is done. Get exact references from the read tools first (get_orders for order references, get_bespoke_pipeline for quote references, get_inventory_status / get_catalogue_health for product names). Kinds and the fields each needs: ' +
        'confirm_order: order_references. ' +
        'reply_to_quote: quote_reference, estimated_completion_days, required_fabric_yards, and either total or line_items; vendor_notes optional. ' +
        'update_stock: product (name), stock (new quantity; yards for fabric), plus color and size when the product has several. ' +
        'create_discount: title, value, value_type (percentage|fixed), applies_to (all|clothing|fabric|accessory|products), products (names, when applies_to is products), start_date/end_date (YYYY-MM-DD, optional; makes it a flash sale). ' +
        'update_listing: product (name) plus any of description, audience, product_type, categories, attributes - taxonomy values ONLY from the allowed lists get_product_listing returns. ' +
        'If the result is an error, ask the vendor the question it raises instead of guessing.',
      input_schema: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: [...ASSISTANT_ACTION_KINDS] },
          order_references: { type: 'array', items: { type: 'string' }, description: 'confirm_order: order references, e.g. ["QLZ-1234"].' },
          quote_reference: { type: 'string', description: 'reply_to_quote: the quote reference from get_bespoke_pipeline.' },
          total: { type: 'number', description: 'reply_to_quote: the price in naira when there is a single line.' },
          line_items: {
            type: 'array',
            items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number' } }, required: ['label', 'amount'] },
            description: 'reply_to_quote: itemised price lines; replaces total.',
          },
          estimated_completion_days: { type: 'number' },
          required_fabric_yards: { type: 'number' },
          vendor_notes: { type: 'string' },
          product: { type: 'string', description: 'update_stock: the product name.' },
          color: { type: 'string' },
          size: { type: 'string' },
          stock: { type: 'number', description: 'update_stock: the NEW quantity (not the change).' },
          title: { type: 'string', description: 'create_discount: the discount name.' },
          value: { type: 'number' },
          value_type: { type: 'string', enum: ['percentage', 'fixed'] },
          applies_to: { type: 'string', enum: ['all', 'clothing', 'fabric', 'accessory', 'products'] },
          products: { type: 'array', items: { type: 'string' }, description: 'create_discount: product names when applies_to is products.' },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          description: { type: 'string', description: 'update_listing: the new product description (40-1500 characters, no links).' },
          audience: { type: 'string', enum: ['men', 'women', 'unisex', 'kids'], description: 'update_listing: who the product is for.' },
          product_type: { type: 'string', description: 'update_listing: one of the allowed product types for the kind.' },
          categories: { type: 'array', items: { type: 'string' }, description: 'update_listing: from the allowed categories for the product type.' },
          attributes: { type: 'array', items: { type: 'string' }, description: 'update_listing: from the allowed attributes for the product type.' },
        },
      },
    };
  }

  // ── Propose ───────────────────────────────────────────────────────────────

  async propose(
    businessId: string,
    conversationId: string | null,
    input: any,
  ): Promise<{ card: AssistantActionCard } | { error: string }> {
    const bid = new Types.ObjectId(businessId);
    const kind = String(input?.kind ?? '') as AssistantActionKind;
    if (!ASSISTANT_ACTION_KINDS.includes(kind)) return { error: `Unknown action kind "${kind}".` };

    let prepared: PrepareOutcome;
    try {
      switch (kind) {
        case 'confirm_order': prepared = await this.prepareConfirmOrder(bid, input); break;
        case 'reply_to_quote': prepared = await this.prepareReplyToQuote(bid, input); break;
        case 'update_stock': prepared = await this.prepareUpdateStock(bid, input); break;
        case 'create_discount': prepared = await this.prepareCreateDiscount(bid, input); break;
        case 'update_listing': prepared = await this.prepareUpdateListing(bid, input); break;
      }
    } catch (err: any) {
      this.logger.warn(`propose ${kind} failed: ${err?.message}`);
      return { error: err?.message ?? 'Could not prepare that action.' };
    }
    if ('error' in prepared) return prepared;

    const doc = await this.actionModel.create({
      business: bid,
      conversation: conversationId && Types.ObjectId.isValid(conversationId) ? new Types.ObjectId(conversationId) : null,
      kind,
      ...prepared,
      status: 'proposed',
      expires_at: new Date(Date.now() + ASSISTANT_ACTION_TTL_HOURS * 3_600_000),
    });
    return { card: toCard(doc) };
  }

  private async prepareConfirmOrder(bid: Types.ObjectId, input: any): Promise<PrepareOutcome> {
    const refs: string[] = [
      ...(Array.isArray(input?.order_references) ? input.order_references : []),
      ...(input?.order_reference ? [input.order_reference] : []),
    ].map((r) => String(r).trim()).filter(Boolean);
    if (!refs.length) return { error: 'Which order? Give order_references (from get_orders).' };
    if (refs.length > MAX_ORDERS_PER_ACTION) return { error: `At most ${MAX_ORDERS_PER_ACTION} orders per action.` };

    const orders = await this.orderModel
      .find({ reference: { $in: refs }, 'items.business': bid })
      .select('reference status payment_status createdAt items shipments')
      .lean();
    const byRef = new Map((orders as any[]).map((o) => [o.reference, o]));

    const confirmable: { reference: string; items: number; amount: number }[] = [];
    const skipped: string[] = [];
    for (const ref of refs) {
      const o = byRef.get(ref);
      if (!o) { skipped.push(`${ref}: not one of your orders`); continue; }
      const s = (o.shipments || []).find((x: any) => String(x.business) === String(bid));
      if (!s) { skipped.push(`${ref}: no shipment of yours on it`); continue; }
      if (s.rejected) { skipped.push(`${ref}: you rejected this one`); continue; }
      if (s.confirmed) { skipped.push(`${ref}: already confirmed`); continue; }
      if (o.status === 'pending' || o.payment_status === 'unpaid') { skipped.push(`${ref}: not paid yet`); continue; }
      if (['cancelled', 'returned', 'completed'].includes(o.status)) { skipped.push(`${ref}: ${o.status}`); continue; }
      confirmable.push({ reference: ref, items: vendorItems(o, bid).length, amount: vendorTotal(o, bid) });
    }
    if (!confirmable.length) return { error: `Nothing to confirm. ${skipped.join('; ')}.` };

    // The deadline the platform will set on confirmation: longest turnaround
    // among the vendor's products on each order, default 3 days.
    const productIds = (orders as any[]).flatMap((o) => vendorItems(o, bid).map((i) => i.product).filter(Boolean));
    const turnaround = new Map<string, number>();
    if (productIds.length) {
      const prods = await this.productModel.find({ _id: { $in: productIds } }).select('clothing.turnaround_days').lean();
      for (const p of prods as any[]) turnaround.set(String(p._id), Number(p.clothing?.turnaround_days) || 0);
    }
    const deadlineDays = (o: any) =>
      Math.max(3, ...vendorItems(o, bid).map((i) => turnaround.get(String(i.product)) ?? 0));

    const total = confirmable.reduce((s, c) => s + c.amount, 0);
    const n = confirmable.length;
    return {
      title: n === 1 ? `Confirm order ${confirmable[0].reference}` : `Confirm ${n} orders`,
      summary:
        `Confirm ${n === 1 ? 'this order' : `these ${n} orders`} (${naira(total)} of your items). ` +
        `Confirming starts the fulfilment clock: each order gets a ship-by deadline from its longest turnaround, and the customer is told you are on it.`,
      details: [
        ...confirmable.map((c) => ({
          label: c.reference,
          value: `${c.items} item${c.items === 1 ? '' : 's'} · ${naira(c.amount)} · ship within ${deadlineDays(byRef.get(c.reference))} days`,
        })),
        ...(skipped.length ? [{ label: 'Skipped', value: skipped.join('; ') }] : []),
      ],
      params: { references: confirmable.map((c) => c.reference) },
    };
  }

  private async prepareReplyToQuote(bid: Types.ObjectId, input: any): Promise<PrepareOutcome> {
    const ref = String(input?.quote_reference ?? input?.quote_id ?? '').trim();
    if (!ref) return { error: 'Which quote? Give quote_reference (from get_bespoke_pipeline).' };
    const query = Types.ObjectId.isValid(ref) && ref.length === 24 ? { _id: new Types.ObjectId(ref) } : { reference: ref };
    const quote: any = await this.quoteModel
      .findOne({ ...query, vendor: bid })
      .populate({ path: 'design', select: 'name category' })
      .lean();
    if (!quote) return { error: `No quote "${ref}" of yours.` };
    if (!['pending', 'draft', 'revision_requested'].includes(quote.status)) {
      return { error: `Quote ${quote.reference} is ${quote.status}; it cannot be sent again.` };
    }

    let lineItems: { label: string; amount: number }[] = Array.isArray(input?.line_items)
      ? input.line_items
          .map((l: any) => ({ label: String(l?.label ?? '').trim(), amount: Number(l?.amount) }))
          .filter((l: any) => l.label && Number.isFinite(l.amount) && l.amount >= 0)
      : [];
    if (!lineItems.length && Number(input?.total) > 0) lineItems = [{ label: 'Tailoring', amount: Number(input.total) }];
    if (!lineItems.length) return { error: 'What price? Give total (or line_items).' };
    const total = lineItems.reduce((s, l) => s + l.amount, 0);
    if (!(total > 0)) return { error: 'The quote total must be above zero.' };

    const days = Number(input?.estimated_completion_days);
    if (!(days >= 1)) return { error: 'How many days to complete? Give estimated_completion_days (at least 1).' };
    const yards = Number(input?.required_fabric_yards ?? quote.required_fabric_yards);
    if (!(yards >= 0.1)) return { error: 'How many yards of fabric does it need? Give required_fabric_yards.' };
    const notes = String(input?.vendor_notes ?? '').trim();

    const design = quote.design?.name ? `"${quote.design.name}"` : 'this design';
    return {
      title: `Send quote for ${design}`,
      summary: `Send the customer a quote of ${naira(total)}, ${days} day${days === 1 ? '' : 's'} to complete, ${yards} yard${yards === 1 ? '' : 's'} of fabric. The customer is notified and can accept it.`,
      details: [
        { label: 'Quote', value: quote.reference },
        ...(quote.design?.category ? [{ label: 'Category', value: String(quote.design.category) }] : []),
        ...lineItems.map((l) => ({ label: l.label, value: naira(l.amount) })),
        { label: 'Total', value: naira(total) },
        { label: 'Completion', value: `${days} day${days === 1 ? '' : 's'}` },
        { label: 'Fabric', value: `${yards} yard${yards === 1 ? '' : 's'}` },
        ...(notes ? [{ label: 'Notes', value: notes.slice(0, 300) }] : []),
      ],
      params: {
        quote_id: String(quote._id),
        reference: quote.reference,
        dto: { line_items: lineItems, required_fabric_yards: yards, estimated_completion_days: days, ...(notes ? { vendor_notes: notes } : {}) },
      },
    };
  }

  private async findVendorProduct(bid: Types.ObjectId, typed: string) {
    const rx = new RegExp(escapeRegex(typed.trim()), 'i');
    const candidates = await this.productModel
      .find({
        business: bid,
        status: { $ne: 'archived' },
        $or: [{ 'clothing.name': rx }, { 'fabric.name': rx }, { 'accessory.name': rx }],
      })
      .select('kind status base_price clothing fabric accessory')
      .lean();
    return pickByName(candidates as any[], typed, productName);
  }

  private async prepareUpdateStock(bid: Types.ObjectId, input: any): Promise<PrepareOutcome> {
    const typed = String(input?.product ?? '').trim();
    if (!typed) return { error: 'Which product? Give product (its name).' };
    const stock = Number(input?.stock);
    if (!Number.isFinite(stock) || stock < 0) return { error: 'What should the stock be? Give stock as the new quantity (0 or more).' };

    const pick = await this.findVendorProduct(bid, typed);
    if ('none' in pick) return { error: `No product of yours named "${typed}".` };
    if ('ambiguous' in pick) return { error: `Several products match "${typed}": ${pick.ambiguous.join(', ')}. Which one?` };
    const product: any = pick.match;

    const resolved = resolveStockTarget(product, input?.color, input?.size);
    if ('error' in resolved) return resolved;
    const t = resolved.target;
    if (t.kind !== 'fabric' && !Number.isInteger(stock)) return { error: 'Stock for this product is counted in whole units.' };

    const name = productName(product);
    const where = [t.color, t.size].filter(Boolean).join(' / ');
    const unit = t.kind === 'fabric' ? 'yards' : 'units';
    return {
      title: `Set stock of ${name}${where ? ` (${where})` : ''}`,
      summary: `Change the stock of ${name}${where ? ` in ${where}` : ''} from ${t.current} to ${stock} ${unit}. Shoppers see the new availability immediately.`,
      details: [
        { label: 'Product', value: name },
        ...(t.color ? [{ label: 'Colour', value: t.color }] : []),
        ...(t.size ? [{ label: 'Size', value: t.size }] : []),
        { label: 'Stock', value: `${t.current} → ${stock} ${unit}` },
      ],
      params: { product_id: String(product._id), kind: t.kind, color: t.color ?? null, size: t.size ?? null, stock },
    };
  }

  private async prepareCreateDiscount(bid: Types.ObjectId, input: any): Promise<PrepareOutcome> {
    const value = Number(input?.value);
    const valueType: 'percentage' | 'fixed' = input?.value_type === 'fixed' ? 'fixed' : 'percentage';
    if (!(value > 0)) return { error: 'How much off? Give value (a percentage, or an amount with value_type fixed).' };
    if (valueType === 'percentage' && value > MAX_PERCENT_OFF) return { error: `A percentage discount cannot exceed ${MAX_PERCENT_OFF}%.` };
    const appliesTo = (['all', 'clothing', 'fabric', 'accessory', 'products'] as const).includes(input?.applies_to) ? input.applies_to : 'all';

    const parseDate = (v: any): Date | null | 'bad' => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? 'bad' : d;
    };
    const start = parseDate(input?.start_date);
    const end = parseDate(input?.end_date);
    if (start === 'bad' || end === 'bad') return { error: 'Dates must be YYYY-MM-DD.' };
    if (start && end && end <= start) return { error: 'end_date must be after start_date.' };
    if (end && end.getTime() < Date.now()) return { error: 'end_date is already in the past.' };

    let productIds: string[] = [];
    let affected = 0;
    const names: string[] = [];
    if (appliesTo === 'products') {
      const typed: string[] = Array.isArray(input?.products) ? input.products.map((p: any) => String(p).trim()).filter(Boolean) : [];
      if (!typed.length) return { error: 'Which products? Give products (names) when applies_to is products.' };
      for (const t of typed) {
        const pick = await this.findVendorProduct(bid, t);
        if ('none' in pick) return { error: `No product of yours named "${t}".` };
        if ('ambiguous' in pick) return { error: `Several products match "${t}": ${pick.ambiguous.join(', ')}. Which one?` };
        productIds.push(String((pick.match as any)._id));
        names.push(productName(pick.match));
      }
      productIds = [...new Set(productIds)];
      affected = productIds.length;
    } else {
      affected = await this.productModel.countDocuments({
        business: bid,
        status: 'active',
        ...(appliesTo === 'all' ? {} : { kind: appliesTo }),
      });
      if (!affected) return { error: appliesTo === 'all' ? 'You have no active products to discount.' : `You have no active ${appliesTo} products.` };
    }

    const title = String(input?.title ?? '').trim() || `${valueType === 'percentage' ? `${value}%` : naira(value)} off${appliesTo === 'all' ? '' : ` ${appliesTo}`}`;
    const req: DiscountRequest = { title, value, value_type: valueType, applies_to: appliesTo, product_ids: productIds, start_date: start, end_date: end };
    return {
      title: `Create discount "${title}"`,
      summary: `${describeDiscount(req, affected)} Prices on the storefront update within a minute.`,
      details: [
        { label: 'Discount', value: valueType === 'percentage' ? `${value}% off` : `${naira(value)} off` },
        { label: 'Applies to', value: appliesTo === 'products' ? names.join(', ') : appliesTo === 'all' ? `All ${affected} active products` : `All ${appliesTo} (${affected})` },
        ...(start ? [{ label: 'Starts', value: start.toDateString() }] : []),
        ...(end ? [{ label: 'Ends', value: end.toDateString() }] : []),
      ],
      params: { dto: buildDiscountDto(req), affected },
    };
  }

  /** The platform's vocabulary for a product: what categories/attributes it may carry. */
  async listingVocabulary(product: any): Promise<ListingVocabulary> {
    const kind = product?.kind;
    const productType = product?.[kind]?.taxonomy?.product_type;
    try {
      const [types, cat] = await Promise.all([
        this.categoryModel.find({ kind, is_active: true }).select('product_type').lean(),
        productType ? this.categoryModel.findOne({ kind, product_type: productType, is_active: true }).lean() : null,
      ]);
      const product_types = (types as any[]).map((t) => t.product_type).filter(Boolean);
      return {
        product_types: product_types.length ? product_types : null,
        categories: cat ? (cat as any).categories ?? [] : null,
        attributes: cat ? (cat as any).attributes ?? [] : null,
      };
    } catch (err: any) {
      this.logger.warn(`Taxonomy vocabulary unavailable: ${err?.message}`);
      return { product_types: null, categories: null, attributes: null };
    }
  }

  private async prepareUpdateListing(bid: Types.ObjectId, input: any): Promise<PrepareOutcome> {
    const typed = String(input?.product ?? '').trim();
    if (!typed) return { error: 'Which product? Give product (its name).' };
    const pick = await this.findVendorProduct(bid, typed);
    if ('none' in pick) return { error: `No product of yours named "${typed}".` };
    if ('ambiguous' in pick) return { error: `Several products match "${typed}": ${pick.ambiguous.join(', ')}. Which one?` };
    const product: any = pick.match;

    // A new product type changes which categories are allowed: validate
    // against the vocabulary of the type being set, not the old one.
    const forVocab = input?.product_type
      ? { ...product, [product.kind]: { ...product[product.kind], taxonomy: { ...(product[product.kind]?.taxonomy ?? {}), product_type: String(input.product_type) } } }
      : product;
    const vocab = await this.listingVocabulary(forVocab);
    const out = validateListingChange(product, input, vocab);
    if ('error' in out) return out;

    const name = productName(product);
    return {
      title: `Update the listing for ${name}`,
      summary: `Change the ${out.changed.join(', ')} of ${name}. Shoppers see the new listing immediately; audience, categories and attributes decide which searches it appears in.`,
      details: [{ label: 'Product', value: name }, ...out.details],
      params: { product_id: String(product._id), set: out.set, changed: out.changed },
    };
  }

  // ── Decide ────────────────────────────────────────────────────────────────

  async get(businessId: string, actionId: string): Promise<AssistantActionCard> {
    return toCard(await this.owned(businessId, actionId));
  }

  async cancel(businessId: string, actionId: string): Promise<AssistantActionCard> {
    const doc = await this.owned(businessId, actionId);
    if (doc.status !== 'proposed') throw new BadRequestException(`This action is already ${doc.status}.`);
    doc.status = 'cancelled';
    doc.decided_at = new Date();
    await doc.save();
    await this.syncEmbedded(doc);
    return toCard(doc);
  }

  async confirm(businessId: string, userId: string | undefined, actionId: string): Promise<AssistantActionCard> {
    const doc = await this.owned(businessId, actionId);
    if (doc.status !== 'proposed') throw new BadRequestException(`This action is already ${doc.status}.`);
    if (doc.expires_at.getTime() < Date.now()) {
      doc.status = 'expired';
      doc.decided_at = new Date();
      await doc.save();
      await this.syncEmbedded(doc);
      throw new BadRequestException('This action has expired. Ask the assistant to prepare it again.');
    }

    doc.confirmed_by = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
    doc.decided_at = new Date();
    try {
      const { result, text } = await this.execute(doc, businessId);
      doc.status = 'executed';
      doc.result = result;
      doc.result_text = text;
    } catch (err: any) {
      this.logger.warn(`action ${doc.kind} ${doc._id} failed: ${err?.message}`);
      doc.status = 'failed';
      doc.error = err?.response?.message ?? err?.message ?? 'Something went wrong.';
      if (Array.isArray(doc.error)) doc.error = (doc.error as any).join('; ');
    }
    await doc.save();
    await this.syncEmbedded(doc);
    return toCard(doc);
  }

  private async execute(doc: AssistantAction, businessId: string): Promise<{ result: Record<string, any>; text: string }> {
    const p = doc.params || {};
    switch (doc.kind) {
      case 'confirm_order': {
        const business = await this.businessModel.findById(doc.business);
        if (!business) throw new Error('Business not found');
        const confirmed: string[] = [];
        const failed: { reference: string; error: string }[] = [];
        for (const ref of p.references as string[]) {
          try {
            await this.orderService.confirmVendorShipment(ref, business);
            confirmed.push(ref);
          } catch (err: any) {
            failed.push({ reference: ref, error: err?.response?.message ?? err?.message ?? 'failed' });
          }
        }
        if (!confirmed.length) throw new Error(failed.map((f) => `${f.reference}: ${f.error}`).join('; '));
        return {
          result: { confirmed, failed },
          text: `Confirmed ${confirmed.join(', ')}${failed.length ? `. Not confirmed - ${failed.map((f) => `${f.reference}: ${f.error}`).join('; ')}` : ''}`,
        };
      }
      case 'reply_to_quote': {
        await this.bespokeService.submitQuote(p.quote_id, businessId, p.dto);
        const total = (p.dto.line_items as any[]).reduce((s, l) => s + Number(l.amount || 0), 0);
        return { result: { quote: p.reference, total }, text: `Quote ${p.reference} sent for ${naira(total)}` };
      }
      case 'update_stock': {
        const product: any = await this.productModel.findOne({ _id: new Types.ObjectId(p.product_id), business: doc.business }).lean();
        if (!product) throw new Error('Product no longer exists');
        // Re-resolve by name: the variant may have moved since the proposal.
        const resolved = resolveStockTarget(product, p.color ?? undefined, p.size ?? undefined);
        if ('error' in resolved) throw new Error(resolved.error);
        const t = resolved.target;
        const norm = (s: any) => String(s ?? '').trim().toLowerCase();
        let res: any;
        if (t.kind === 'fabric') {
          res = await this.productModel.updateOne({ _id: product._id }, { $set: { 'fabric.yard_length': p.stock } });
        } else if (t.kind === 'clothing') {
          const ci = product.clothing.color_variants.findIndex((c: any) => norm(c?.name) === norm(t.color));
          const vi = product.clothing.color_variants[ci].variants.findIndex((v: any) => norm(v?.size) === norm(t.size));
          res = await this.productModel.updateOne(
            { _id: product._id },
            { $set: { [`clothing.color_variants.${ci}.variants.${vi}.stock`]: p.stock } },
          );
        } else {
          const vi = product.accessory.variants.findIndex(
            (v: any) => norm(v?.color?.name) === norm(t.color) && norm(v?.size) === norm(t.size),
          );
          res = await this.productModel.updateOne({ _id: product._id }, { $set: { [`accessory.variants.${vi}.stock`]: p.stock } });
        }
        if (!res?.matchedCount && !res?.n) throw new Error('Stock update did not apply');
        const fresh = await this.productModel.findById(product._id).lean();
        // Same event the dashboard's save fires: catalog sync, discounts, size guides.
        this.events.emit('product.upserted', fresh);
        const where = [t.color, t.size].filter(Boolean).join(' / ');
        return {
          result: { product: productName(product), where, before: t.current, after: p.stock },
          text: `${productName(product)}${where ? ` (${where})` : ''}: stock ${t.current} → ${p.stock}`,
        };
      }
      case 'create_discount': {
        const created: any = await this.discountService.create(p.dto, businessId);
        return { result: { discount_id: String(created?._id), title: p.dto.title }, text: `Discount "${p.dto.title}" created` };
      }
      case 'update_listing': {
        const res = await this.productModel.updateOne(
          { _id: new Types.ObjectId(p.product_id), business: doc.business },
          { $set: p.set },
        );
        if (!res?.matchedCount) throw new Error('Product no longer exists');
        const fresh: any = await this.productModel.findById(p.product_id).lean();
        // Same event the dashboard's save fires: catalog sync (and its facts), discounts, size guides.
        this.events.emit('product.upserted', fresh);
        return { result: { product: productName(fresh), changed: p.changed }, text: `${productName(fresh)}: ${(p.changed as string[]).join(', ')} updated` };
      }
      default:
        throw new Error(`Unknown action kind ${doc.kind}`);
    }
  }

  /** Keep the copy embedded in the conversation message in step, so a reopened thread shows the outcome. */
  private async syncEmbedded(doc: AssistantAction) {
    if (!doc.conversation) return;
    const id = String(doc._id);
    try {
      await this.conversationModel.updateOne(
        { _id: doc.conversation, 'messages.actions.action_id': id },
        {
          $set: {
            'messages.$[m].actions.$[a].status': doc.status,
            'messages.$[m].actions.$[a].result_text': doc.result_text ?? null,
            'messages.$[m].actions.$[a].error': doc.error ?? null,
          },
        },
        { arrayFilters: [{ 'm.actions.action_id': id }, { 'a.action_id': id }] },
      );
    } catch (err: any) {
      this.logger.warn(`Could not sync action ${id} into its conversation: ${err?.message}`);
    }
  }

  private async owned(businessId: string, actionId: string) {
    if (!Types.ObjectId.isValid(actionId) || !Types.ObjectId.isValid(businessId)) {
      throw new NotFoundException('Action not found');
    }
    const doc = await this.actionModel.findOne({ _id: new Types.ObjectId(actionId), business: new Types.ObjectId(businessId) });
    if (!doc) throw new NotFoundException('Action not found');
    return doc;
  }
}
