import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Return, ReturnDocument, ReturnStatus } from './schemas/return.schema';
import { CreateReturnDto } from './dto/create-return.dto';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/orders.schema';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from '../business/schemas/business-earnings.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { VendorRecipientsService } from '../notifications/vendor-recipients.service';
import { VendorRole } from '../ums/schemas/role.schema';

// A return is fulfilment work and a customer conversation at once.
const RETURN_ROLES = [VendorRole.OPERATIONS, VendorRole.CUSTOMER_SUPPORT];

// After a rejection the customer can still dispute it; the payout is held at
// least this long so that is possible.
const REJECTION_DISPUTE_DAYS = 3;
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import { ProductService } from '../products/products.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @InjectModel(Return.name)
    private readonly returnModel: Model<ReturnDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(BusinessEarning.name)
    private readonly businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectModel('Event')
    private readonly recEventModel: Model<any>,
    private readonly notificationsService: NotificationsService,
    private readonly vendorRecipients: VendorRecipientsService,
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
    private readonly productService: ProductService,
  ) {}

  /**
   * Customer requests a return (within return window)
   */
  async requestReturn(customerId: string, dto: CreateReturnDto) {
    const order = await this.orderModel.findOne({
      reference: dto.order_reference,
      customer: customerId,
      status: OrderStatus.COMPLETED,
    });
    if (!order) throw new BadRequestException('Order not found or not eligible for return');

    // Check return window
    const settings = await this.platformSettingsModel.findOne().lean();
    const returnWindowDays = (settings as any)?.return_window_days ?? 7;

    const latestDelivery = Math.max(
      ...order.shipments.map((s) => (s as any).delivered_at?.getTime() || 0),
    );
    if (latestDelivery === 0) {
      throw new BadRequestException('Order has not been delivered yet');
    }

    const returnDeadline = latestDelivery + returnWindowDays * 86400000;
    if (Date.now() > returnDeadline) {
      throw new BadRequestException(
        `Return window has expired (${returnWindowDays} days from delivery)`,
      );
    }

    // Pieces made to the customer's measurements cannot be returned; a
    // problem with one is a dispute. The shop hid the button, but the API
    // accepted them.
    const requested = new Set((dto.item_ids || []).map(String));
    const lines = (order.items || []).filter(
      (i: any) =>
        String(i.business) === String(dto.business_id) &&
        requested.has(String(i.product)),
    );
    if (!lines.length) {
      throw new BadRequestException('None of these items are from this vendor on this order');
    }
    let madeToFit =
      (order as any).type === 'bespoke' ||
      lines.some((i: any) => i.clothing_type === 'customize');
    // Orders placed before order items stored clothing_type: ask the product.
    const unknown = lines.filter((i: any) => !i.clothing_type && i.product);
    if (!madeToFit && unknown.length) {
      const Product: any = (this.orderModel.db as any).models?.Product;
      if (Product) {
        const custom = await Product.exists({
          _id: { $in: unknown.map((i: any) => i.product) },
          'clothing.type': 'customize',
        });
        madeToFit = Boolean(custom);
      }
    }
    if (madeToFit) {
      throw new BadRequestException(
        'Pieces made to your measurements cannot be returned. If something is wrong with one, report a problem instead.',
      );
    }

    // Check for existing open return
    const existingReturn = await this.returnModel.findOne({
      order: order._id,
      business: dto.business_id,
      status: { $in: [ReturnStatus.REQUESTED, ReturnStatus.VENDOR_APPROVED, ReturnStatus.RETURN_SHIPPED] },
    });
    if (existingReturn) {
      throw new BadRequestException('You already have an active return request for this vendor');
    }

    // Freeze earnings
    await this.businessEarningsModel.updateMany(
      { order: order._id, business: dto.business_id, released: false },
      { $set: { release_date: null } },
    );

    const returnRequest = await this.returnModel.create({
      order: order._id,
      order_reference: order.reference,
      customer: customerId,
      business: dto.business_id,
      items: dto.item_ids.map((id) => new Types.ObjectId(id)),
      reason: dto.reason,
      description: dto.description || '',
      evidence_urls: dto.evidence_urls || [],
    });

    this.logger.log(
      `[Return] Customer ${customerId} requested return for order ${order.reference}, vendor ${dto.business_id}`,
    );

    // Notify everyone at the vendor who handles returns.
    const returnRecipients = await this.vendorRecipients.resolve(
      dto.business_id,
      RETURN_ROLES,
    );
    for (const member of returnRecipients) {
      this.notificationsService.create({
        recipient: member.userId,
        recipient_business: dto.business_id,
        category: NotificationCategory.ORDER,
        // Was ORDER_CANCELLED under the title "Return Request", so a return
        // counted as a cancellation anywhere notifications are grouped by type.
        type: NotificationType.RETURN_REQUESTED,
        title: 'Return Request 📦',
        body: `A customer has requested a return for order #${order.reference}. Reason: ${dto.reason}.`,
        metadata: {
          order_reference: order.reference,
          return_id: returnRequest._id,
        },
        action_url: `/orders?tab=returns`,
      }).catch((err) =>
        this.logger.error(`Failed to notify vendor about return: ${err.message}`),
      );
    }

    return { message: 'Return request submitted. The vendor will review it shortly.', data: returnRequest };
  }

  /**
   * Get customer's returns
   */
  async getCustomerReturns(customerId: string) {
    return this.returnModel
      .find({ customer: customerId })
      .sort({ createdAt: -1 })
      .populate('business', 'business_name logo')
      .lean();
  }

  /**
   * Vendor approves a return
   */
  async approveReturn(returnId: string, businessId: string) {
    const returnReq = await this.returnModel.findById(returnId);
    if (!returnReq) throw new NotFoundException('Return request not found');
    if (returnReq.business.toString() !== businessId) {
      throw new BadRequestException('This return is not for your business');
    }
    if (returnReq.status !== ReturnStatus.REQUESTED) {
      throw new BadRequestException('This return request cannot be approved in its current state');
    }

    returnReq.status = ReturnStatus.VENDOR_APPROVED;
    await returnReq.save();

    this.logger.log(`[Return] Vendor ${businessId} approved return ${returnId}`);
    this.notifyCustomerApproved(returnReq);
    return { message: 'Return approved. Customer has been notified.', data: returnReq };
  }

  /**
   * Hourly: a return the vendor has not answered within
   * `return_auto_approve_days` is approved on their behalf, so the customer
   * is never left waiting on silence. The claim is atomic (status still
   * REQUESTED), so overlapping runs approve once.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoApproveStaleReturns() {
    try {
      const settings: any = await this.platformSettingsModel.findOne().lean();
      const days = Number(settings?.return_auto_approve_days ?? 3);
      if (!(days > 0)) return;
      const cutoff = new Date(Date.now() - days * 86400000);
      const stale = await this.returnModel
        .find({ status: ReturnStatus.REQUESTED, createdAt: { $lte: cutoff } })
        .limit(200);
      for (const r of stale) {
        const claim = await this.returnModel.updateOne(
          { _id: r._id, status: ReturnStatus.REQUESTED },
          { $set: { status: ReturnStatus.VENDOR_APPROVED, auto_approved: true } },
        );
        if (claim.modifiedCount !== 1) continue;
        r.status = ReturnStatus.VENDOR_APPROVED;
        this.logger.log(`[Return] Auto-approved return ${r._id} after ${days} day(s) unanswered`);
        this.notifyCustomerApproved(r);
        const team = await this.vendorRecipients.resolve(r.business, RETURN_ROLES);
        for (const member of team) {
          this.notificationsService
            .create({
              recipient: member.userId,
              recipient_business: String(r.business),
              category: NotificationCategory.ORDER,
              type: NotificationType.RETURN_REQUESTED,
              title: 'Return approved automatically',
              body: `The return for order #${r.order_reference} was not answered within ${days} day(s), so it was approved. Mark it received when the items arrive back.`,
              metadata: { order_reference: r.order_reference, return_id: r._id },
              action_url: '/orders?tab=returns',
            })
            .catch((err) => this.logger.error(`Auto-approve vendor notice failed: ${err.message}`));
        }
      }
    } catch (err: any) {
      this.logger.error(`[Return] Auto-approve run failed: ${err?.message}`);
    }
  }

  private notifyCustomerApproved(returnReq: any) {    // Notify customer
    this.notificationsService.create({
      recipient: returnReq.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Return Approved ✅',
      body: `The vendor has approved your return for order #${returnReq.order_reference}. Please ship the items back.`,
      metadata: {
        order_reference: returnReq.order_reference,
        return_id: returnReq._id,
      },
      action_url: `/orders`,
    }).catch((err) =>
      this.logger.error(`Failed to notify customer about return approval: ${err.message}`),
    );
  }

  /**
   * Vendor rejects a return
   */
  async rejectReturn(returnId: string, businessId: string, reason: string) {
    const returnReq = await this.returnModel.findById(returnId);
    if (!returnReq) throw new NotFoundException('Return request not found');
    if (returnReq.business.toString() !== businessId) {
      throw new BadRequestException('This return is not for your business');
    }
    if (returnReq.status !== ReturnStatus.REQUESTED) {
      throw new BadRequestException('This return request cannot be rejected in its current state');
    }
    const why = (reason ?? '').trim();
    if (why.length < 3) {
      throw new BadRequestException('Tell the customer why you are rejecting this return.');
    }

    returnReq.status = ReturnStatus.VENDOR_REJECTED;
    returnReq.vendor_rejection_reason = why;
    await returnReq.save();

    // The customer is told they can dispute a rejection, which is only
    // possible while the payout is still held. Releasing at once let the
    // payout go out within half an hour and the dispute was then refused.
    // Re-hold until the later of the normal delivery schedule and three days
    // from now.
    const order = await this.orderModel.findById(returnReq.order).lean();
    const settings: any = await this.platformSettingsModel.findOne().lean();
    const holdDays = Math.max(
      Number(settings?.payout_delay_days ?? 3),
      Number(settings?.return_window_days ?? 7),
    );
    const delivered = Math.max(
      0,
      ...((order as any)?.shipments ?? []).map((s: any) =>
        s.delivered_at ? new Date(s.delivered_at).getTime() : 0,
      ),
    );
    const releaseAt = new Date(
      Math.max(
        delivered ? delivered + holdDays * 86400000 : 0,
        Date.now() + REJECTION_DISPUTE_DAYS * 86400000,
      ),
    );
    await this.businessEarningsModel.updateMany(
      { order: returnReq.order, business: businessId, released: false },
      { $set: { release_date: releaseAt } },
    );

    this.logger.log(`[Return] Vendor ${businessId} rejected return ${returnId}`);

    // Notify customer
    this.notificationsService.create({
      recipient: returnReq.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Return Rejected',
      body: `Your return for order #${returnReq.order_reference} was rejected. Reason: ${why}. If you disagree, report a problem on the order within ${REJECTION_DISPUTE_DAYS} days.`,
      metadata: {
        order_reference: returnReq.order_reference,
        return_id: returnReq._id,
      },
      action_url: `/orders`,
    }).catch((err) =>
      this.logger.error(`Failed to notify customer about return rejection: ${err.message}`),
    );

    return { message: 'Return rejected. Customer has been notified.', data: returnReq };
  }

  /**
   * Vendor marks return items as received + processes refund
   */
  async markReceived(returnId: string, businessId: string) {
    const returnReq = await this.returnModel.findById(returnId);
    if (!returnReq) throw new NotFoundException('Return request not found');
    if (returnReq.business.toString() !== businessId) {
      throw new BadRequestException('This return is not for your business');
    }
    if (![ReturnStatus.VENDOR_APPROVED, ReturnStatus.RETURN_SHIPPED].includes(returnReq.status)) {
      throw new BadRequestException('Return must be approved or shipped before marking as received');
    }

    returnReq.status = ReturnStatus.RECEIVED;
    returnReq.received_at = new Date();

    // Calculate refund: item total_price for returned items
    const order = await this.orderModel.findById(returnReq.order);
    if (!order) throw new NotFoundException('Order not found');

    const returnedItemIds = returnReq.items.map((id) => id.toString());
    // This vendor's order lines being returned (return items are product ids).
    const returnedLines = order.items.filter(
      (i: any) =>
        returnedItemIds.includes(i.product?.toString()) &&
        String(i.business) === String(businessId) &&
        !i.rejected,
    );
    const refundAmount = returnedLines.reduce(
      (sum, i) => sum + ((i as any).total_price || 0),
      0,
    );

    returnReq.refund_amount = refundAmount;

    // Refund the returned items - and only them - to the customer's wallet,
    // however they paid. The gateway refund used here before sent back the
    // WHOLE original charge, so a one-item return on a multi-vendor card
    // order refunded the entire order while only this vendor's earning was
    // reversed.
    if (refundAmount > 0) {
      await this.walletsService.refundToCustomerWallet({
        order,
        amount: refundAmount,
        reason: 'return_refund',
        description: `Refund for returned items on order ${order.reference}`,
        metadata: { return_id: (returnReq._id as any).toString() },
      });
      await this.orderModel.updateOne(
        { _id: order._id, refund_status: { $ne: 'refunded' } },
        { $set: { refund_status: 'partial' } },
      );
    }

    // Reverse ONLY the returned items' share of this vendor's earnings, and
    // keep the wallet ledger in sync. Every earning used to be reversed, so a
    // one-item return on a three-item order took all three. Earnings are
    // linked to their order line; legacy rows without a link give up the
    // returned share of their value instead.
    const clawedBack = await this.reverseReturnedEarnings(
      order,
      businessId,
      returnedLines,
      refundAmount,
    );

    // Restock only what came back. Restoring by order put every item of the
    // order back in stock, returned or not.
    for (const line of returnedLines as any[]) {
      if (!line._id) continue;
      await this.productService
        .restoreInventory(order._id as any, businessId, line._id)
        .catch((e: any) =>
          this.logger.error(`Restock failed for ${order.reference} line ${line._id}: ${e?.message}`),
        );
    }

    // Tell the vendor what the refund took from their earnings.
    if (refundAmount > 0) {
      const team = await this.vendorRecipients.resolve(businessId, RETURN_ROLES);
      for (const member of team) {
        this.notificationsService
          .create({
            recipient: member.userId,
            recipient_business: String(businessId),
            category: NotificationCategory.ORDER,
            type: NotificationType.RETURN_REQUESTED,
            title: 'Return refunded',
            body: `The customer was refunded ₦${refundAmount.toLocaleString()} for the returned items on order #${order.reference}. ₦${clawedBack.toLocaleString()} came out of your earnings for those items.`,
            metadata: {
              order_reference: order.reference,
              return_id: returnReq._id,
              refund_amount: refundAmount,
              earnings_reversed: clawedBack,
            },
            action_url: '/orders?tab=returns',
          })
          .catch((err) => this.logger.error(`Return refund vendor notice failed: ${err.message}`));
      }
    }

    returnReq.status = ReturnStatus.REFUND_PROCESSED;
    returnReq.refunded_at = new Date();
    await returnReq.save();

    // Recommender signal: a completed return is the natural negative
    // counterpart to purchase — "bought it, sent it back". Server-side so
    // every client is covered. Fire-and-forget.
    {
      const now = new Date();
      this.recEventModel
        .insertMany(
          (returnReq.items || []).map((id: any) => ({
            userId: returnReq.customer.toString(),
            eventType: 'return_item',
            properties: { itemId: id.toString(), reason: returnReq.reason },
            context: { surface: 'returns' },
            metadata: { order_reference: returnReq.order_reference },
            timestamp: now,
          })),
          { ordered: false },
        )
        .catch((e: any) =>
          this.logger.warn(`Failed to record return_item events: ${e?.message}`),
        );
    }

    // If every still-active item in the order has now been returned+refunded,
    // reflect that on the order itself — otherwise a fully returned order keeps
    // reading as "completed". Partial returns (some items/vendors) leave the
    // order completed.
    const processedReturns = await this.returnModel
      .find({ order: returnReq.order, status: ReturnStatus.REFUND_PROCESSED })
      .lean();
    const returnedProductIds = new Set<string>();
    processedReturns.forEach((r) =>
      (r.items || []).forEach((i: any) => returnedProductIds.add(i.toString())),
    );
    const activeItems = order.items.filter((i: any) => !i.rejected);
    const allReturned =
      activeItems.length > 0 &&
      activeItems.every((i: any) =>
        returnedProductIds.has(i.product?.toString()),
      );
    if (allReturned && order.status !== OrderStatus.RETURNED) {
      order.status = OrderStatus.RETURNED;
      await order.save();
      this.logger.log(
        `[Return] Order ${order.reference} fully returned → status RETURNED`,
      );
    }

    this.logger.log(
      `[Return] Return ${returnId} received + refund of ₦${refundAmount.toLocaleString()} processed`,
    );

    // Notify customer
    this.notificationsService.create({
      recipient: returnReq.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Return Completed & Refunded 💰',
      body: `Your return for order #${returnReq.order_reference} has been received. ₦${refundAmount.toLocaleString()} will be refunded to your account.`,
      metadata: {
        order_reference: returnReq.order_reference,
        return_id: returnReq._id,
        refund_amount: refundAmount,
      },
      action_url: `/orders`,
    }).catch((err) =>
      this.logger.error(`Failed to notify customer about return refund: ${err.message}`),
    );

    return {
      message: `Return processed. ₦${refundAmount.toLocaleString()} refunded to customer.`,
      data: returnReq,
    };
  }

  /**
   * Reverse the returned lines' share of a vendor's earnings on an order.
   * Item-linked earnings for those lines are reversed in full; legacy
   * earnings with no item link lose the returned fraction of their value.
   * Released money comes out of the balance (any shortfall becomes owed),
   * held money out of pending. Returns the total reversed.
   */
  private async reverseReturnedEarnings(
    order: any,
    businessId: string,
    returnedLines: any[],
    refundAmount: number,
  ): Promise<number> {
    const lineIds = new Set(returnedLines.map((l: any) => String(l._id)));
    const vendorItemsTotal = (order.items || [])
      .filter((i: any) => String(i.business) === String(businessId) && !i.rejected)
      .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
    const fraction =
      vendorItemsTotal > 0 ? Math.min(1, refundAmount / vendorItemsTotal) : 0;

    const earnings = await this.businessEarningsModel.find({
      order: order._id,
      business: businessId,
      milestone: { $ne: 'cancellation_fee' },
    });

    let reversed = 0;
    for (const earning of earnings as any[]) {
      const net = earning.net_amount || 0;
      if (net <= 0) continue;
      const linked = earning.item ? lineIds.has(String(earning.item)) : null;
      // Linked to another line: not part of this return.
      if (linked === false) continue;
      const take = linked ? net : Math.round(net * fraction);
      if (take <= 0) continue;

      if (earning.released) {
        await this.walletsService.reconcileBusinessWallet(earning.business, {
          balance: -take,
        });
        earning.net_amount = net - take;
        await earning.save();
      } else {
        await this.walletsService.reconcileBusinessWallet(earning.business, {
          pending: -take,
        });
        if (net - take <= 0) {
          await this.businessEarningsModel.deleteOne({ _id: earning._id });
        } else {
          earning.net_amount = net - take;
          await earning.save();
        }
      }
      reversed += take;
    }
    return reversed;
  }

  /**
   * Get vendor's returns, newest first, optionally one status.
   */
  async getVendorReturns(businessId: string, status?: string) {
    const filter: Record<string, any> = { business: businessId };
    if (status && Object.values(ReturnStatus).includes(status as ReturnStatus)) {
      filter.status = status;
    }
    return this.returnModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('customer', 'full_name email')
      .lean();
  }
}
