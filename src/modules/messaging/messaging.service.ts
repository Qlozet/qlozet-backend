import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  OrderMessage,
  OrderMessageDocument,
} from './schemas/order-message.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

// Bespoke order statuses during which new messages may be sent (production +
// fulfilment). Reading history is allowed in any state.
const SENDABLE_STATUSES = ['processing', 'in_transit'];

// Emitted after a message is persisted; the MessagingGateway pushes it live to
// each participant's socket room.
export const ORDER_MESSAGE_CREATED = 'order-message.created';
export interface OrderMessageCreatedEvent {
  message: any;
  participantUserIds: string[];
}

type Caller = { user?: { id?: string }; business?: { id?: string } };

@Injectable()
export class MessagingService {
  constructor(
    @InjectModel(OrderMessage.name)
    private readonly messageModel: Model<OrderMessageDocument>,
    @InjectModel('Order') private readonly orderModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
    private readonly eventEmitter: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  // Resolve the order + the caller's role in its thread. Messaging is a
  // customer <-> tailor channel on BESPOKE orders only.
  private async resolveThread(reference: string, req: Caller) {
    const order = await this.orderModel
      .findOne({ reference })
      .select('customer type shipments reference status')
      .lean();
    if (!order) throw new NotFoundException('Order not found');
    if ((order as any).type !== 'bespoke') {
      throw new ForbiddenException(
        'Messaging is only available on bespoke orders.',
      );
    }

    const shipments: any[] = (order as any).shipments || [];
    const tailorShipment =
      shipments.find((s) => s.shipment_type === 'vendor_to_customer') ||
      shipments[0];
    const tailorBusinessId = tailorShipment
      ? String(tailorShipment.business)
      : null;

    const callerBusiness = req.business?.id ? String(req.business.id) : null;
    const callerUser = req.user?.id ? String(req.user.id) : null;

    let role: 'customer' | 'vendor' | null = null;
    if (callerBusiness && callerBusiness === tailorBusinessId) role = 'vendor';
    else if (callerUser && callerUser === String((order as any).customer))
      role = 'customer';

    if (!role) {
      throw new ForbiddenException('You are not a participant on this order.');
    }
    if (!tailorBusinessId) {
      throw new BadRequestException('This order has no tailor to message.');
    }

    return { order, role, tailorBusinessId };
  }

  async listMessages(reference: string, req: Caller) {
    const { order, role } = await this.resolveThread(reference, req);

    const messages = await this.messageModel
      .find({ order: (order as any)._id })
      .sort({ createdAt: 1 })
      .lean();

    // Mark the reader's side as read.
    const readField =
      role === 'vendor' ? 'read_by_vendor' : 'read_by_customer';
    await this.messageModel.updateMany(
      { order: (order as any)._id, [readField]: false },
      { $set: { [readField]: true } },
    );

    return { data: messages };
  }

  async sendMessage(reference: string, req: Caller, content?: string) {
    const { order, role, tailorBusinessId } = await this.resolveThread(
      reference,
      req,
    );

    const body = (content || '').trim();
    if (!body) throw new BadRequestException('Message content is required.');
    if (!SENDABLE_STATUSES.includes((order as any).status)) {
      throw new BadRequestException(
        'Messaging is only open while the order is in production or transit.',
      );
    }

    const message = await this.messageModel.create({
      order: (order as any)._id,
      order_reference: (order as any).reference,
      customer: (order as any).customer,
      business: new Types.ObjectId(tailorBusinessId),
      sender: new Types.ObjectId(req.user!.id),
      sender_role: role,
      content: body,
      read_by_customer: role === 'customer',
      read_by_vendor: role === 'vendor',
    });

    // Push the new message live to both participants (customer + tailor's user).
    const business: any = await this.businessModel
      .findById(tailorBusinessId)
      .select('created_by')
      .lean();
    const vendorUserId = business?.created_by?.id
      ? String(business.created_by.id)
      : null;
    const participantUserIds = [
      String((order as any).customer),
      ...(vendorUserId ? [vendorUserId] : []),
    ];
    this.eventEmitter.emit(ORDER_MESSAGE_CREATED, {
      message: message.toObject ? message.toObject() : message,
      participantUserIds,
    } as OrderMessageCreatedEvent);

    // The socket above only reaches someone who has the thread open. The bell
    // is what reaches everyone else, so raise one for the RECIPIENT only —
    // notifying the sender of their own message is noise.
    //
    // createUnique keyed on order_id collapses a burst into a single entry: a
    // back-and-forth about a sleeve length should not leave fourteen bell
    // rows. Once the recipient opens the thread the notification is marked
    // read, so the next message after that raises a fresh one.
    //
    // Awaited, not fired and forgotten: the method swallows its own errors, so
    // this cannot fail a message that is already saved and pushed, and a
    // detached promise could otherwise be dropped as the request winds down.
    await this.raiseMessageNotification(
      order,
      role,
      tailorBusinessId,
      vendorUserId,
      body,
    );

    return { data: message };
  }

  /**
   * One bell entry for whoever did not send the message. Never throws — the
   * caller relies on that to keep a delivered message from failing.
   */
  private async raiseMessageNotification(
    order: any,
    senderRole: 'customer' | 'vendor',
    tailorBusinessId: string,
    vendorUserId: string | null,
    body: string,
  ) {
    try {
      // A snippet, not the whole message — the bell is a nudge, and the thread
      // is one tap away. Only ever shown to the other participant, who is
      // entitled to read the message in full anyway.
      const snippet = body.length > 90 ? `${body.slice(0, 90).trimEnd()}...` : body;
      const reference = String(order.reference);

      if (senderRole === 'customer') {
        if (!vendorUserId) return; // no owner on the tailor's business
        const business: any = await this.businessModel
          .findById(tailorBusinessId)
          .select('business_name')
          .lean();
        await this.notifications.createUnique(
          {
            recipient: vendorUserId,
            recipient_business: tailorBusinessId,
            category: NotificationCategory.BESPOKE,
            type: NotificationType.NEW_MESSAGE,
            title: `New message on ${reference}`,
            body: snippet,
            metadata: {
              order_id: String(order._id),
              order_reference: reference,
              business_name: business?.business_name,
            },
            action_url: '/orders',
          },
          'order_id',
        );
        return;
      }

      await this.notifications.createUnique(
        {
          recipient: String(order.customer),
          category: NotificationCategory.BESPOKE,
          type: NotificationType.NEW_MESSAGE,
          title: `Your tailor replied about ${reference}`,
          body: snippet,
          metadata: {
            order_id: String(order._id),
            order_reference: reference,
          },
          action_url: '/profile?tab=orders',
        },
        'order_id',
      );
    } catch {
      // Swallowed deliberately — see the call site.
    }
  }

  /**
   * Unread message counts for the caller, total and per order reference.
   *
   * This is what makes the chat usable: without it the only way to find a
   * reply is to open every order in turn. Both sides are counted from the
   * caller's own read flag, and a message the caller sent is never unread to
   * them (it is written read on their side at creation, but the sender_role
   * guard keeps that true even for a message an admin injects).
   */
  async unreadCounts(req: Caller) {
    const businessId = req.business?.id ? String(req.business.id) : null;
    const userId = req.user?.id ? String(req.user.id) : null;

    // Guard BEFORE building the $match — casting an absent id throws a
    // BSONError rather than falling through to the empty result below.
    if (!businessId && !userId) {
      return { data: { total: 0, per_order: {} } };
    }

    const match: Record<string, any> = businessId
      ? {
          business: new Types.ObjectId(businessId),
          read_by_vendor: false,
          sender_role: { $ne: 'vendor' },
        }
      : {
          customer: new Types.ObjectId(String(userId)),
          read_by_customer: false,
          sender_role: { $ne: 'customer' },
        };

    const rows = await this.messageModel.aggregate([
      { $match: match },
      { $group: { _id: '$order_reference', count: { $sum: 1 } } },
    ]);

    const per_order: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      if (!row?._id) continue;
      per_order[String(row._id)] = row.count;
      total += row.count;
    }

    return { data: { total, per_order } };
  }

  // Admin read-only (guarded by @Roles(PLATFORM) at the controller).
  async adminList(reference: string) {
    const order = await this.orderModel
      .findOne({ reference })
      .select('_id')
      .lean();
    if (!order) throw new NotFoundException('Order not found');
    const messages = await this.messageModel
      .find({ order: (order as any)._id })
      .sort({ createdAt: 1 })
      .lean();
    return { data: messages };
  }
}
