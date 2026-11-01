import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderStatus, ShipmentStatus, ShipmentType } from './schemas/orders.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { VendorRecipientsService } from '../notifications/vendor-recipients.service';
import { MailService } from '../notifications/mail/mail.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { VendorRole } from '../ums/schemas/role.schema';
import { UserService } from '../ums/services/users.service';

/** The body parts a customer can record (and a tailor can ask about). */
export const MEASUREMENT_KEYS = [
  'chest', 'waist', 'hip', 'shoulder_breadth', 'arm_length', 'leg_length',
  'bicep', 'forearm', 'thigh', 'calf', 'wrist', 'ankle', 'height',
  'shoulder_to_crotch', 'inseam', 'outseam', 'sleeve_length', 'nape_to_waist',
  'neck', 'neck_base', 'knee', 'mid_thigh', 'lower_thigh', 'belly_waist',
  'top_hip', 'under_bust', 'waist_height', 'ankle_height', 'neck_height',
  'shoulder_width', 'across_back',
] as const;

const OPEN_ORDER = new Set<string>([OrderStatus.IN_REVIEW, OrderStatus.PROCESSING, OrderStatus.PENDING]);
const SHIPPED = new Set<string>([ShipmentStatus.SHIPPED, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED]);

/** Who at the vendor hears the answer: the people making it. */
const MAKERS = [VendorRole.OPERATIONS, VendorRole.TAILOR];

const escapeHtml = (t: string) =>
  t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

const label = (key: string) => key.replace(/_/g, ' ');

/**
 * A tailor asks the customer about the measurements an order is made to; the
 * customer answers with corrected numbers, which replace the order's own copy.
 *
 * Made-to-order pieces cannot be returned, so the time to catch a wrong
 * number is before the cloth is cut. This replaced a "flag" that filed a
 * dispute nobody was told about.
 */
@Injectable()
export class MeasurementQuestionsService {
  private readonly logger = new Logger(MeasurementQuestionsService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly notifications: NotificationsService,
    private readonly vendorRecipients: VendorRecipientsService,
    private readonly mail: MailService,
    @Optional()
    @Inject(forwardRef(() => UserService))
    private readonly users?: UserService,
  ) {}

  /**
   * Copy the customer's corrections into their saved measurement set, the
   * one this order was measured from (by name; the active set when the order
   * didn't record one). Goes through the normal set update, so the numbers
   * are marked as measured by the customer, the set's method and updated_at
   * move, and body type is recomputed. Returns the set's name, or null with
   * the reason it couldn't be saved; the order's answer stands either way.
   */
  private async saveToProfile(
    customerId: string,
    orderCopy: { set_name?: string | null; unit?: string },
    changes: { body_part: string; to: number }[],
  ): Promise<{ set: string | null; reason?: string }> {
    if (!this.users) return { set: null, reason: 'unavailable' };
    const { sets } = await this.users.getAllMeasurementSets(customerId);
    const set =
      (orderCopy.set_name
        ? sets.find((s: any) => s.name === orderCopy.set_name)
        : sets.find((s: any) => s.active)) ?? null;
    if (!set) return { set: null, reason: 'set_missing' };
    // The answer is in the order copy's unit; the saved set may use the other.
    const from = orderCopy.unit === 'inch' ? 'inch' : 'cm';
    const to = (set as any).unit === 'inch' ? 'inch' : 'cm';
    const factor = from === to ? 1 : from === 'cm' ? 1 / 2.54 : 2.54;
    const measurements: Record<string, number> = {};
    for (const c of changes) {
      measurements[c.body_part] = Math.round(c.to * factor * 10) / 10;
    }
    await this.users.updateMeasurementSet(customerId, (set as any).name, {
      measurements,
    } as any);
    return { set: (set as any).name };
  }

  /** The copy a question is about: one made-to-order line, or the order's own. */
  private target(order: any, itemId: string | null) {
    if (itemId) {
      const item = (order.items || []).find((i: any) => String(i._id) === itemId);
      if (!item?.body_profile) throw new NotFoundException('That item has no measurements to ask about.');
      return { kind: 'item' as const, item, profile: item.body_profile };
    }
    const profile = order.customer_body_profile;
    if (!profile?.measurements) throw new NotFoundException('This order has no measurements to ask about.');
    return { kind: 'order' as const, item: null, profile };
  }

  async ask(
    reference: string,
    businessId: string,
    userId: string,
    dto: { item_id?: string | null; body_parts?: string[]; message?: string },
  ) {
    const order: any = await this.orderModel.findOne({ reference });
    if (!order) throw new NotFoundException('Order not found');
    const bid = String(businessId);

    const shipment = (order.shipments || []).find(
      (s: any) => String(s.business) === bid && s.shipment_type !== ShipmentType.FABRIC_TRANSFER,
    );
    const ownsItem = (order.items || []).some((i: any) => String(i.business) === bid);
    if (!ownsItem) throw new ForbiddenException('This order does not belong to your business.');
    if (order.payment_status !== 'paid' || !OPEN_ORDER.has(order.status)) {
      throw new BadRequestException('You can only ask about measurements on a paid order that is still being made.');
    }
    if (shipment && SHIPPED.has(shipment.status)) {
      throw new BadRequestException('This piece has already shipped.');
    }

    const itemId = dto.item_id ? String(dto.item_id) : null;
    if (itemId) {
      const item = (order.items || []).find((i: any) => String(i._id) === itemId);
      if (!item || String(item.business) !== bid) throw new ForbiddenException('That item is not yours.');
    }
    this.target(order, itemId);

    const message = (dto.message || '').trim();
    if (message.length < 10) throw new BadRequestException('Say what you need to check (at least 10 characters).');
    if (message.length > 600) throw new BadRequestException('Keep the question under 600 characters.');
    const bodyParts = Array.from(new Set((dto.body_parts || []).map(String)))
      .filter((k) => (MEASUREMENT_KEYS as readonly string[]).includes(k));

    const open = (order.measurement_questions || []).find(
      (q: any) => q.status === 'open' && String(q.business) === bid && String(q.item_id ?? '') === String(itemId ?? ''),
    );
    if (open) throw new BadRequestException('You already have a question waiting for this customer.');

    const question = {
      _id: new Types.ObjectId(),
      business: new Types.ObjectId(bid),
      item_id: itemId ? new Types.ObjectId(itemId) : null,
      body_parts: bodyParts,
      message,
      status: 'open',
      asked_by: new Types.ObjectId(String(userId)),
      asked_at: new Date(),
      answered_at: null,
      answer_message: null,
      changes: [],
    };
    order.measurement_questions = [...(order.measurement_questions || []), question];
    order.markModified('measurement_questions');
    await order.save();

    await this.tellCustomer(order, bid, question).catch((e) =>
      this.logger.warn(`Measurement question notice failed: ${e?.message}`),
    );

    return { message: 'Question sent to the customer.', data: question };
  }

  private async tellCustomer(order: any, businessId: string, question: any) {
    const populated: any = await this.orderModel
      .findById(order._id)
      .select('customer shipments')
      .populate('customer', 'email full_name')
      .populate('shipments.business', 'business_name')
      .lean();
    const shop =
      (populated?.shipments || []).find((s: any) => String(s.business?._id ?? s.business) === businessId)?.business
        ?.business_name || 'Your tailor';
    const parts = question.body_parts.length ? ` (${question.body_parts.map(label).join(', ')})` : '';
    await this.notifications.create({
      recipient: String(order.customer),
      audience: 'customer',
      category: NotificationCategory.ORDER,
      type: NotificationType.MEASUREMENT_QUESTION,
      title: 'Your tailor has a question about your measurements',
      body: `${shop} is checking your measurements${parts} for order #${order.reference} before cutting. Reply from the order.`,
      metadata: { order_reference: order.reference, question_id: String(question._id) },
      action_url: '/profile?tab=orders',
    });
    const email = populated?.customer?.email;
    if (email) {
      await this.mail.sendAnnouncementEmail(
        email,
        `A question about your measurements for order #${order.reference}`,
        `<p>${escapeHtml(shop)} is about to make your order and wants to check your measurements${escapeHtml(parts)} first.</p>` +
          `<blockquote>${escapeHtml(question.message)}</blockquote>` +
          `<p>Open the order in your Qlozet account to check the numbers and reply. If anything is wrong, you can correct it for this order there.</p>`,
        populated?.customer?.full_name,
        process.env.FRONTEND_URL
          ? `${process.env.FRONTEND_URL}/profile?tab=orders&order=${encodeURIComponent(order.reference)}`
          : undefined,
      );
    }
  }

  /** The customer's questions on one of their orders, with the numbers now on file. */
  async listForCustomer(reference: string, customerId: string) {
    const order: any = await this.orderModel
      .findOne({ reference })
      .select('customer items customer_body_profile measurement_questions shipments')
      .populate('shipments.business', 'business_name')
      .lean();
    if (!order || String(order.customer) !== String(customerId)) throw new NotFoundException('Order not found');
    const shopName = (bid: any) =>
      (order.shipments || []).find((s: any) => String(s.business?._id ?? s.business) === String(bid))?.business
        ?.business_name ?? null;
    const data = (order.measurement_questions || []).map((q: any) => {
      let profile: any = null;
      try {
        profile = this.target(order, q.item_id ? String(q.item_id) : null).profile;
      } catch {
        profile = null;
      }
      return {
        _id: String(q._id),
        item_id: q.item_id ? String(q.item_id) : null,
        shop_name: shopName(q.business),
        set_name: profile?.set_name ?? null,
        body_parts: q.body_parts ?? [],
        message: q.message,
        status: q.status,
        asked_at: q.asked_at,
        answered_at: q.answered_at ?? null,
        unit: profile?.unit || 'cm',
        measurements: profile?.measurements ?? {},
      };
    });
    return { data };
  }

  /**
   * The customer's answer: corrected numbers (in the copy's own unit) and/or a
   * note. Corrections replace the order's copy only; their saved set is theirs
   * to change separately.
   */
  async answer(
    reference: string,
    customerId: string,
    questionId: string,
    dto: { measurements?: Record<string, number>; message?: string; save_to_profile?: boolean },
  ) {
    const order: any = await this.orderModel.findOne({ reference });
    if (!order || String(order.customer) !== String(customerId)) throw new NotFoundException('Order not found');
    const q = (order.measurement_questions || []).find((x: any) => String(x._id) === String(questionId));
    if (!q) throw new NotFoundException('Question not found');
    if (q.status !== 'open') throw new BadRequestException('You have already answered this question.');

    const target = this.target(order, q.item_id ? String(q.item_id) : null);
    const corrections = Object.entries(dto.measurements || {}).filter(
      ([k, v]) => (MEASUREMENT_KEYS as readonly string[]).includes(k) && v !== null && v !== undefined,
    );
    for (const [k, v] of corrections) {
      const n = Number(v);
      if (!(n > 0 && n < 300)) throw new BadRequestException(`${label(k)} must be a positive measurement.`);
    }
    const note = (dto.message || '').trim().slice(0, 600);
    if (!corrections.length && !note) {
      throw new BadRequestException('Correct a measurement or add a note for your tailor.');
    }

    const changes: { body_part: string; from: number | null; to: number }[] = [];
    const apply = (profile: any) => {
      const m = { ...(profile.measurements || {}) };
      const meta = profile.tailoring_meta ? { ...profile.tailoring_meta } : null;
      for (const [k, v] of corrections) {
        const before = m[k] ?? null;
        if (Number(before) === Number(v)) continue;
        m[k] = Number(v);
        if (meta) meta[k] = { tier: 'measured', mae_cm: null, method: 'customer_correction' };
        if (!changes.some((c) => c.body_part === k)) changes.push({ body_part: k, from: before, to: Number(v) });
      }
      profile.measurements = m;
      if (meta) profile.tailoring_meta = meta;
      profile.updated_by_customer_at = new Date();
    };

    if (target.kind === 'item') {
      apply(target.item.body_profile);
      // The order's own copy of the same set (a bespoke order holds it on
      // both) stays in step, so every screen shows the corrected numbers.
      const own = order.customer_body_profile;
      if (own?.measurements && (own.set_name ?? null) === (target.item.body_profile.set_name ?? null)) {
        apply(own);
        order.markModified('customer_body_profile');
      }
    } else {
      // A bespoke order holds the copy twice (order and its one line).
      apply(order.customer_body_profile);
      for (const item of order.items || []) {
        if (
          String(item.business) === String(q.business) &&
          item.body_profile &&
          (item.body_profile.set_name ?? null) === (order.customer_body_profile.set_name ?? null)
        ) {
          apply(item.body_profile);
        }
      }
      order.markModified('customer_body_profile');
    }
    order.markModified('items');

    q.status = 'answered';
    q.answered_at = new Date();
    q.answer_message = note || null;
    q.changes = changes;
    order.markModified('measurement_questions');
    await order.save();

    // Optional: the same corrections into the customer's saved set, so the
    // next order doesn't start from the wrong number again. Never fails the
    // answer — the order copy is what the tailor needs right now.
    let savedTo: string | null = null;
    let notSavedReason: string | undefined;
    if (dto.save_to_profile && changes.length) {
      try {
        const res = await this.saveToProfile(String(customerId), target.profile, changes);
        savedTo = res.set;
        notSavedReason = res.reason;
      } catch (e: any) {
        notSavedReason = 'failed';
        this.logger.warn(`Saving measurement answer to profile failed: ${e?.message}`);
      }
    }

    const summary = changes.length
      ? changes.map((c) => `${label(c.body_part)} ${c.from ?? '—'} → ${c.to}`).join(', ')
      : 'no changes';
    const makers = await this.vendorRecipients.resolve(String(q.business), MAKERS);
    for (const member of makers) {
      this.notifications
        .create({
          recipient: member.userId,
          recipient_business: String(q.business),
          category: NotificationCategory.ORDER,
          type: NotificationType.MEASUREMENT_ANSWERED,
          title: 'The customer answered about their measurements',
          body: `Order #${order.reference}: ${summary}.${note ? ` "${note.slice(0, 140)}"` : ''}`,
          metadata: { order_reference: order.reference, question_id: String(q._id), changes },
          action_url: '/orders',
        })
        .catch((e) => this.logger.warn(`Measurement answer notice failed: ${e?.message}`));
    }

    const message = savedTo
      ? `Thanks — your tailor has your answer, and "${savedTo}" in your measurements is updated too.`
      : dto.save_to_profile && changes.length
        ? notSavedReason === 'set_missing'
          ? "Thanks — your tailor has your answer. The measurement set this order used isn't in your profile any more, so update your measurements there."
          : 'Thanks — your tailor has your answer. Your saved measurements could not be updated; change them in your profile.'
        : 'Thanks — your tailor has your answer.';
    return { message, data: { changes, saved_to_profile: savedTo } };
  }
}
