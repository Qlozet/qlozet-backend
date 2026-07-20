import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Dispute, DisputeDocument, DisputeStatus } from './schemas/dispute.schema';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeResolution, ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/orders.schema';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from '../business/schemas/business-earnings.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionType, TransactionStatus } from '../transactions/schema/transaction.schema';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    @InjectModel(Dispute.name)
    private readonly disputeModel: Model<DisputeDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(BusinessEarning.name)
    private readonly businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
  ) {}

  /**
   * Customer files a dispute against a vendor for a delivered order.
   * Freezes the vendor's payout by setting release_date = null.
   */
  async fileDispute(customerId: string, dto: CreateDisputeDto) {
    const order = await this.orderModel.findOne({
      reference: dto.order_reference,
      customer: customerId,
      status: OrderStatus.COMPLETED,
    });
    if (!order) {
      throw new BadRequestException('Order not found or not eligible for dispute');
    }

    // Check if payout has already been released
    const releasedEarnings = await this.businessEarningsModel.find({
      order: order._id,
      business: dto.business_id,
      released: true,
    });
    if (releasedEarnings.length > 0) {
      throw new BadRequestException(
        'Vendor payment has already been released. Please contact support.',
      );
    }

    // Check for existing open dispute
    const existingDispute = await this.disputeModel.findOne({
      order: order._id,
      business: dto.business_id,
      status: { $in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
    });
    if (existingDispute) {
      throw new BadRequestException('You already have an open dispute for this vendor on this order');
    }

    // Freeze payout: set release_date = null on all unreleased earnings
    await this.businessEarningsModel.updateMany(
      { order: order._id, business: dto.business_id, released: false },
      { $set: { release_date: null } },
    );

    const dispute = await this.disputeModel.create({
      order: order._id,
      order_reference: order.reference,
      customer: customerId,
      business: dto.business_id,
      reason: dto.reason,
      description: dto.description,
      evidence_urls: dto.evidence_urls || [],
    });

    this.logger.log(
      `[Dispute] Customer ${customerId} filed dispute for order ${order.reference} against vendor ${dto.business_id}`,
    );

    // Notify vendor
    const business = await this.businessModel.findById(dto.business_id);
    if (business?.created_by?.id) {
      this.notificationsService.create({
        recipient: business.created_by.id.toString(),
        category: NotificationCategory.ORDER,
        type: NotificationType.ORDER_CANCELLED,
        title: 'Customer Filed a Dispute ⚠️',
        body: `A customer has filed a dispute for order #${order.reference}. Reason: ${dto.reason}. Please review and respond.`,
        metadata: {
          order_id: order._id,
          order_reference: order.reference,
          dispute_id: dispute._id,
          reason: dto.reason,
        },
        action_url: `/orders`,
      }).catch((err) =>
        this.logger.error(`Failed to notify vendor about dispute: ${err.message}`),
      );
    }

    return { message: 'Dispute filed successfully. Vendor payout has been frozen.', data: dispute };
  }

  /**
   * Customer's disputes list
   */
  async getCustomerDisputes(customerId: string) {
    return this.disputeModel
      .find({ customer: customerId })
      .sort({ createdAt: -1 })
      .populate('business', 'business_name logo')
      .lean();
  }

  /**
   * Vendor's disputes list
   */
  async getVendorDisputes(businessId: string) {
    return this.disputeModel
      .find({ business: businessId })
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Vendor responds to a dispute with counter-evidence
   */
  async respondToDispute(disputeId: string, businessId: string, response: string, evidenceUrls?: string[]) {
    const dispute = await this.disputeModel.findById(disputeId);
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.business.toString() !== businessId) {
      throw new BadRequestException('This dispute is not for your business');
    }
    if (![DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW].includes(dispute.status)) {
      throw new BadRequestException('This dispute has already been resolved');
    }

    dispute.vendor_response = response;
    dispute.vendor_evidence_urls = evidenceUrls || [];
    dispute.status = DisputeStatus.UNDER_REVIEW;
    await dispute.save();

    this.logger.log(`[Dispute] Vendor ${businessId} responded to dispute ${disputeId}`);

    return { message: 'Response submitted. The dispute is now under admin review.', data: dispute };
  }

  /**
   * Admin resolves a dispute
   */
  async resolveDispute(disputeId: string, adminId: string, dto: ResolveDisputeDto) {
    const dispute = await this.disputeModel.findById(disputeId);
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (![DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW].includes(dispute.status)) {
      throw new BadRequestException('This dispute has already been resolved');
    }

    const order = await this.orderModel.findById(dispute.order);
    if (!order) throw new NotFoundException('Order not found');

    const businessId = dispute.business.toString();

    switch (dto.resolution) {
      case DisputeResolution.FULL_REFUND: {
        // Calculate total vendor amount for this business
        const earnings = await this.businessEarningsModel.find({
          order: dispute.order,
          business: businessId,
          released: false,
        });
        const totalRefund = earnings.reduce((sum, e) => sum + (e.net_amount || 0), 0);

        dispute.status = DisputeStatus.RESOLVED_REFUND;
        dispute.refund_amount = totalRefund;

        // Delete unreleased earnings
        await this.businessEarningsModel.deleteMany({
          order: dispute.order,
          business: businessId,
          released: false,
        });

        // Issue refund to customer
        await this.processDisputeRefund(order, totalRefund, `Dispute resolved: full refund`);
        break;
      }

      case DisputeResolution.PARTIAL_REFUND: {
        if (!dto.refund_amount || dto.refund_amount <= 0) {
          throw new BadRequestException('refund_amount is required for partial refund');
        }

        dispute.status = DisputeStatus.RESOLVED_PARTIAL_REFUND;
        dispute.refund_amount = dto.refund_amount;

        // Reduce earnings
        await this.businessEarningsModel.updateMany(
          { order: dispute.order, business: businessId, released: false },
          { $inc: { net_amount: -dto.refund_amount } },
        );

        // Unfreeze remaining earnings
        await this.businessEarningsModel.updateMany(
          { order: dispute.order, business: businessId, released: false },
          { $set: { release_date: new Date() } },
        );

        // Issue partial refund
        await this.processDisputeRefund(order, dto.refund_amount, `Dispute resolved: partial refund`);
        break;
      }

      case DisputeResolution.RELEASE_TO_VENDOR: {
        dispute.status = DisputeStatus.RESOLVED_RELEASED;

        // Unfreeze payout
        await this.businessEarningsModel.updateMany(
          { order: dispute.order, business: businessId, released: false },
          { $set: { release_date: new Date() } },
        );
        break;
      }
    }

    dispute.resolved_by = new Types.ObjectId(adminId);
    dispute.resolved_at = new Date();
    dispute.admin_notes = dto.admin_notes || undefined;
    await dispute.save();

    this.logger.log(
      `[Dispute] Admin ${adminId} resolved dispute ${disputeId} as ${dto.resolution}`,
    );

    // Notify customer
    this.notificationsService.create({
      recipient: dispute.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Dispute Resolved',
      body: `Your dispute for order #${dispute.order_reference} has been resolved: ${dto.resolution.replace(/_/g, ' ')}.${dispute.refund_amount ? ` Refund: ₦${dispute.refund_amount.toLocaleString()}` : ''}`,
      metadata: {
        order_reference: dispute.order_reference,
        dispute_id: dispute._id,
        resolution: dto.resolution,
      },
      action_url: `/orders`,
    }).catch((err) =>
      this.logger.error(`Failed to notify customer about resolution: ${err.message}`),
    );

    // Notify vendor
    const business = await this.businessModel.findById(businessId);
    if (business?.created_by?.id) {
      this.notificationsService.create({
        recipient: business.created_by.id.toString(),
        category: NotificationCategory.ORDER,
        type: NotificationType.ORDER_CONFIRMED,
        title: 'Dispute Resolved',
        body: `Dispute for order #${dispute.order_reference} has been resolved: ${dto.resolution.replace(/_/g, ' ')}.`,
        metadata: {
          order_reference: dispute.order_reference,
          dispute_id: dispute._id,
          resolution: dto.resolution,
        },
        action_url: `/orders`,
      }).catch((err) =>
        this.logger.error(`Failed to notify vendor about resolution: ${err.message}`),
      );
    }

    return { message: `Dispute resolved: ${dto.resolution}`, data: dispute };
  }

  /**
   * Admin lists all disputes
   */
  async getAllDisputes(status?: string) {
    const filter: any = {};
    if (status) filter.status = status;

    return this.disputeModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('business', 'business_name logo')
      .populate('customer', 'first_name last_name email')
      .lean();
  }

  /**
   * Process a refund from a dispute resolution
   */
  private async processDisputeRefund(order: OrderDocument, amount: number, reason: string) {
    if (amount <= 0) return;

    const originalTransaction = await this.transactionService.findByOrderId(
      (order._id as any).toString(),
    );
    if (!originalTransaction) {
      this.logger.error(`[Dispute] No transaction found for order ${order.reference}`);
      return;
    }

    if (originalTransaction.channel === 'wallet_checkout' && originalTransaction.wallet) {
      await this.walletsService.creditWallet(
        originalTransaction.wallet.toString(),
        amount,
      );
    } else {
      await this.transactionService
        .refundPaystackPayment(originalTransaction.reference)
        .catch((err) =>
          this.logger.error(`[Dispute] Paystack refund failed: ${err.message}`),
        );
    }
  }
}
