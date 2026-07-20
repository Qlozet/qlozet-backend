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
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import { ProductService } from '../products/products.service';

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
    private readonly notificationsService: NotificationsService,
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

    // Notify vendor
    const business = await this.businessModel.findById(dto.business_id);
    if (business?.created_by?.id) {
      this.notificationsService.create({
        recipient: business.created_by.id.toString(),
        category: NotificationCategory.ORDER,
        type: NotificationType.ORDER_CANCELLED,
        title: 'Return Request 📦',
        body: `A customer has requested a return for order #${order.reference}. Reason: ${dto.reason}.`,
        metadata: {
          order_reference: order.reference,
          return_id: returnRequest._id,
        },
        action_url: `/orders`,
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

    // Notify customer
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

    return { message: 'Return approved. Customer has been notified.', data: returnReq };
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

    returnReq.status = ReturnStatus.VENDOR_REJECTED;
    returnReq.vendor_rejection_reason = reason;
    await returnReq.save();

    // Unfreeze earnings since return was rejected
    await this.businessEarningsModel.updateMany(
      { order: returnReq.order, business: businessId, released: false },
      { $set: { release_date: new Date() } },
    );

    this.logger.log(`[Return] Vendor ${businessId} rejected return ${returnId}`);

    // Notify customer
    this.notificationsService.create({
      recipient: returnReq.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Return Rejected',
      body: `Your return for order #${returnReq.order_reference} was rejected. Reason: ${reason}. You may file a dispute if you disagree.`,
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
    const refundAmount = order.items
      .filter((i) => returnedItemIds.includes(i.product?.toString()))
      .reduce((sum, i) => sum + ((i as any).total_price || 0), 0);

    returnReq.refund_amount = refundAmount;

    // Issue refund
    if (refundAmount > 0) {
      const originalTransaction = await this.transactionService.findByOrderId(
        (order._id as any).toString(),
      );

      if (originalTransaction?.channel === 'wallet_checkout' && originalTransaction.wallet) {
        await this.walletsService.creditWallet(
          originalTransaction.wallet.toString(),
          refundAmount,
        );
      } else if (originalTransaction) {
        await this.transactionService
          .refundPaystackPayment(originalTransaction.reference)
          .catch((err) =>
            this.logger.error(`[Return] Paystack refund failed: ${err.message}`),
          );
      }
    }

    // Reverse vendor earnings
    await this.businessEarningsModel.deleteMany({
      order: returnReq.order,
      business: businessId,
      released: false,
    });

    // Restore inventory
    await this.productService.restoreInventory((returnReq.order as any).toString());

    returnReq.status = ReturnStatus.REFUND_PROCESSED;
    returnReq.refunded_at = new Date();
    await returnReq.save();

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
   * Get vendor's returns
   */
  async getVendorReturns(businessId: string) {
    return this.returnModel
      .find({ business: businessId })
      .sort({ createdAt: -1 })
      .lean();
  }
}
