import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OrderMessage,
  OrderMessageDocument,
} from './schemas/order-message.schema';

// Bespoke order statuses during which new messages may be sent (production +
// fulfilment). Reading history is allowed in any state.
const SENDABLE_STATUSES = ['processing', 'in_transit'];

type Caller = { user?: { id?: string }; business?: { id?: string } };

@Injectable()
export class MessagingService {
  constructor(
    @InjectModel(OrderMessage.name)
    private readonly messageModel: Model<OrderMessageDocument>,
    @InjectModel('Order') private readonly orderModel: Model<any>,
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

    return { data: message };
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
