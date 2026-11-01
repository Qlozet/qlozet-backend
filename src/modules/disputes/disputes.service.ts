import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DISPUTE_WINDOW_DAYS } from '../business/settlement';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Dispute, DisputeDocument, DisputeReason, DisputeStatus } from './schemas/dispute.schema';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeResolution, ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/orders.schema';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from '../business/schemas/business-earnings.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../notifications/mail/mail.service';
import { VendorRecipientsService } from '../notifications/vendor-recipients.service';
import { VendorRole } from '../ums/schemas/role.schema';

// Who at a vendor hears about a dispute. The tailor made the garment being
// disputed and is the only person who can say what was done; customer support
// handles the correspondence. The owner is always included by the resolver.
// Operations can respond (see VENDOR_AREAS 'disputes.respond'), the tailor
// knows what was made, support talks to the customer.
const DISPUTE_ROLES = [VendorRole.OPERATIONS, VendorRole.TAILOR, VendorRole.CUSTOMER_SUPPORT];
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  reduceEarning,
  syncOrderEarningTotals,
} from '../business/order-earning-totals';
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
    private readonly mailService: MailService,
    private readonly vendorRecipients: VendorRecipientsService,
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
  ) {}

  /**
   * A "not received" report is accepted once this vendor's parcel is
   * genuinely overdue: the courier reported a failed delivery, marked it
   * delivered (the customer says otherwise), or has had it longer than the
   * slowest normal delivery plus two days' grace. Before the courier has it
   * at all, it is a late shipment, which is compensated automatically.
   */
  private async assertParcelOverdue(order: any, businessId: string) {
    const shipment = (order.shipments ?? []).find(
      (s: any) =>
        String(s.business) === String(businessId) &&
        s.shipment_type !== 'fabric_transfer',
    );
    if (!shipment) {
      throw new BadRequestException('This vendor has no delivery on this order.');
    }
    if (['failed', 'delivered'].includes(shipment.status)) return;

    const collected = shipment.shipped_at ? new Date(shipment.shipped_at) : null;
    if (!collected || !['shipped', 'in_transit'].includes(shipment.status)) {
      throw new BadRequestException(
        'The vendor has not handed this parcel to the courier yet. If they are late, you are compensated automatically.',
      );
    }

    const settings: any = await this.orderModel.db
      .collection('platformsettings')
      .findOne({}, { projection: { delivery_transit_max_days: 1 } })
      .catch(() => null);
    const transitMax = Number(settings?.delivery_transit_max_days) || 5;
    const dueBy = new Date(collected.getTime() + (transitMax + 2) * 86400000);
    if (Date.now() < dueBy.getTime()) {
      const fmt = (d: Date) =>
        d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      throw new BadRequestException(
        `The courier collected this parcel on ${fmt(collected)}. If it has not arrived by ${fmt(dueBy)}, report it then.`,
      );
    }
  }

  /**
   * Take up to `amount` back from earnings already paid to this vendor for
   * this order (payouts are never held for a dispute, so a refund can land
   * after the vendor was paid). Comes out of their wallet balance; a
   * shortfall is booked as owed and recovered from later earnings. Returns
   * what was taken.
   */
  private async recoverFromPaidEarnings(
    orderId: Types.ObjectId | string,
    businessId: string,
    amount: number,
  ): Promise<number> {
    if (!(amount > 0)) return 0;
    const paid = await this.businessEarningsModel
      .find({
        order: orderId,
        business: businessId,
        released: true,
        milestone: { $ne: 'cancellation_fee' },
      })
      .sort({ createdAt: -1 });
    let remaining = amount;
    let taken = 0;
    for (const e of paid) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, e.net_amount || 0);
      if (take <= 0) continue;
      await this.walletsService.reconcileBusinessWallet(
        businessId as any,
        { balance: -take },
        {
          order: orderId,
          description: 'Dispute refund on a paid order',
          metadata: { earning_id: String(e._id), reason: 'dispute' },
        },
      );
      reduceEarning(e, take, { refund: true });
      await e.save();
      remaining -= take;
      taken += take;
    }
    return taken;
  }

  /**
   * Customer files a dispute against a vendor for a delivered order.
   * The vendor's payout is not held (settlement.ts); a refund decided after
   * payout is recovered from the vendor's balance.
   */
  async fileDispute(customerId: string, dto: CreateDisputeDto) {
    // Every other problem is about what arrived, so it needs a delivered
    // order. "Not received" is the one that cannot wait for delivery.
    const notReceived = dto.reason === DisputeReason.NOT_RECEIVED;
    const order = await this.orderModel.findOne({
      reference: dto.order_reference,
      customer: customerId,
      status: { $in: [OrderStatus.PROCESSING, OrderStatus.IN_TRANSIT, OrderStatus.COMPLETED] },
    });
    if (!order) {
      throw new BadRequestException('Order not found or not eligible for dispute');
    }
    if (notReceived) {
      await this.assertParcelOverdue(order, dto.business_id);
    } else if ((order as any).status !== OrderStatus.COMPLETED) {
      // Every other problem is about what arrived: allowed once THIS
      // vendor's parcel is delivered (payouts are per parcel, so waiting for
      // the whole order could let this vendor's money go first).
      const parcel = (order.shipments || []).find(
        (s: any) =>
          String(s.business) === String(dto.business_id) &&
          s.shipment_type !== 'fabric_transfer',
      ) as any;
      if (!parcel || parcel.status !== 'delivered') {
        throw new BadRequestException('Order not found or not eligible for dispute');
      }
    }

    // A problem can be reported up to DISPUTE_WINDOW_DAYS after this
    // vendor's parcel was delivered, whether or not the vendor has been paid.
    if (!notReceived) {
      const delivered = (order.shipments || [])
        .filter(
          (s: any) =>
            String(s.business) === String(dto.business_id) && s.delivered_at,
        )
        .map((s: any) => new Date(s.delivered_at).getTime());
      const deliveredAt = delivered.length ? Math.max(...delivered) : 0;
      if (
        deliveredAt &&
        Date.now() > deliveredAt + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ) {
        throw new BadRequestException(
          `Problems can be reported up to ${DISPUTE_WINDOW_DAYS} days after delivery. Please contact support.`,
        );
      }
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
    // Everyone at the vendor who can act on this, not only the account that
    // signed the business up. The tailor is the person who can say what was
    // actually made, and they were previously told nothing.
    const vendorRecipients = await this.vendorRecipients.resolve(
      dto.business_id,
      DISPUTE_ROLES,
    );

    for (const recipient of vendorRecipients) {
      this.notificationsService
        .create({
          recipient: recipient.userId,
          recipient_business: dto.business_id,
          category: NotificationCategory.ORDER,
          type: NotificationType.DISPUTE_OPENED,
          title: 'Customer Filed a Dispute ⚠️',
          body: `A customer has filed a dispute for order #${order.reference}. Reason: ${dto.reason}. Please review and respond.`,
          metadata: {
            order_id: order._id,
            order_reference: order.reference,
            dispute_id: dispute._id,
            reason: dto.reason,
          },
          action_url: `/orders`,
        })
        .catch((err) =>
          this.logger.error(`Failed to notify vendor about dispute: ${err.message}`),
        );

      // The money is held from this moment with no deadline on the
      // arbitration, so the bell alone is not enough — they may not open the
      // platform for days. Fire-and-forget: a mail failure must not roll back
      // a dispute already filed and a payout already frozen.
      if (recipient.email) {
        this.mailService
          .sendDisputeOpenedEmail(
            recipient.email,
            recipient.name || 'there',
            order.reference,
            dto.reason,
            dto.description,
          )
          .catch((err) =>
            this.logger.error(
              `Failed to email vendor about dispute: ${err?.message}`,
            ),
          );
      }
    }

    // Admins arbitrate disputes — every platform user gets the work-queue ping.
    this.notificationsService.notifyPlatformAdmins({
      category: NotificationCategory.ORDER,
      type: NotificationType.DISPUTE_OPENED,
      title: 'New Dispute Opened',
      body: `A customer filed a dispute on order #${order.reference} against ${business?.business_name ?? 'a vendor'}. Reason: ${dto.reason}.`,
      metadata: {
        order_id: order._id,
        order_reference: order.reference,
        dispute_id: dispute._id,
        business_id: dto.business_id,
        reason: dto.reason,
      },
      action_url: '/disputes',
    });

    return { message: 'Dispute filed successfully.', data: dispute };
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
  async getVendorDisputes(businessId: string, status?: string) {
    const filter: Record<string, any> = { business: businessId };
    if (status === 'resolved') {
      filter.status = {
        $in: [
          DisputeStatus.RESOLVED_REFUND,
          DisputeStatus.RESOLVED_PARTIAL_REFUND,
          DisputeStatus.RESOLVED_RELEASED,
          DisputeStatus.CLOSED,
        ],
      };
    } else if (status && Object.values(DisputeStatus).includes(status as DisputeStatus)) {
      filter.status = status;
    }
    return this.disputeModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('customer', 'full_name email')
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
    // What the vendor gives up, for their notification.
    let vendorLoses = 0;

    switch (dto.resolution) {
      case DisputeResolution.FULL_REFUND: {
        // A full refund is what the customer PAID for this vendor's items -
        // not the vendor's net earnings, which left the platform keeping its
        // commission on an order it had just refunded and the customer short
        // by that much. Items are the source; legacy orders without item
        // prices fall back to the gross recorded on the earnings.
        const earnings = await this.businessEarningsModel.find({
          order: dispute.order,
          business: businessId,
          released: false,
        });
        const itemsGross = (order.items || [])
          .filter(
            (i: any) => i.business?.toString() === businessId && !i.rejected,
          )
          .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
        const earningsNet = earnings.reduce((sum, e) => sum + (e.net_amount || 0), 0);
        // The fallback counts paid and unpaid earnings alike: payouts are not
        // held, so the vendor may already have been paid for this order.
        const allEarnings = await this.businessEarningsModel.find({
          order: dispute.order,
          business: businessId,
          milestone: { $ne: 'cancellation_fee' },
        });
        const allGross = allEarnings.reduce((sum, e) => sum + (e.amount || 0), 0);
        const allNet = allEarnings.reduce((sum, e) => sum + (e.net_amount || 0), 0);
        const totalRefund = itemsGross > 0 ? itemsGross : allGross > 0 ? allGross : allNet;

        dispute.status = DisputeStatus.RESOLVED_REFUND;
        dispute.refund_amount = totalRefund;
        vendorLoses = earningsNet;

        // Delete unreleased earnings, and take them out of the wallet's
        // pending figure too, or "Pending Earnings" stays inflated.
        await this.businessEarningsModel.deleteMany({
          order: dispute.order,
          business: businessId,
          released: false,
        });
        if (earningsNet > 0) {
          await this.walletsService
            .reconcileBusinessWallet(businessId as any, { pending: -earningsNet })
            .catch((e: any) =>
              this.logger.error(`Pending reconcile failed for dispute ${disputeId}: ${e?.message}`),
            );
        }

        // Earnings already paid out for this order are recovered from the
        // vendor's balance (any shortfall is booked as owed).
        vendorLoses += await this.recoverFromPaidEarnings(
          dispute.order as any,
          businessId,
          Number.MAX_SAFE_INTEGER,
        );

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

        // Take the refund out of the held earnings ONCE, spread across the
        // rows (an order paid in milestones has several). Reducing every row
        // by the full amount took it once per row. Never below zero.
        const held = await this.businessEarningsModel
          .find({ order: dispute.order, business: businessId, released: false })
          .sort({ createdAt: -1 });
        let remaining = dto.refund_amount;
        for (const e of held) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, e.net_amount || 0);
          if (take <= 0) continue;
          reduceEarning(e, take, { refund: true });
          await e.save();
          remaining -= take;
        }
        vendorLoses = dto.refund_amount - Math.max(0, remaining);
        if (vendorLoses > 0) {
          await this.walletsService
            .reconcileBusinessWallet(businessId as any, { pending: -vendorLoses })
            .catch((e: any) =>
              this.logger.error(`Pending reconcile failed for dispute ${disputeId}: ${e?.message}`),
            );
        }

        // Whatever the unpaid earnings didn't cover comes out of what the
        // vendor was already paid for this order.
        if (remaining > 0) {
          vendorLoses += await this.recoverFromPaidEarnings(
            dispute.order as any,
            businessId,
            remaining,
          );
        }

        // Issue partial refund
        await this.processDisputeRefund(order, dto.refund_amount, `Dispute resolved: partial refund`);
        break;
      }

      case DisputeResolution.RELEASE_TO_VENDOR: {
        dispute.status = DisputeStatus.RESOLVED_RELEASED;

        // Nothing to do: the payout was never held.
        break;
      }
    }

    // The order's earnings totals follow its earning rows.
    if (dto.resolution !== DisputeResolution.RELEASE_TO_VENDOR) {
      await syncOrderEarningTotals(
        this.orderModel,
        this.businessEarningsModel,
        dispute.order as any,
      ).catch((e: any) =>
        this.logger.warn(`Order totals sync failed for dispute ${disputeId}: ${e?.message}`),
      );
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
      audience: 'customer',
      category: NotificationCategory.ORDER,
      type: NotificationType.DISPUTE_RESOLVED,
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

    // Everyone who was told about the dispute hears how it ended.
    const resolutionRecipients = await this.vendorRecipients.resolve(
      businessId,
      DISPUTE_ROLES,
    );
    for (const recipient of resolutionRecipients) {
      this.notificationsService
        .create({
          recipient: recipient.userId,
          recipient_business: String(businessId),
          category: NotificationCategory.ORDER,
          // Was ORDER_CONFIRMED, under a title reading "Dispute Resolved" —
          // so a resolved dispute was counted as a confirmed order.
          type: NotificationType.DISPUTE_RESOLVED,
          title: 'Dispute Resolved',
          body:
            dto.resolution === DisputeResolution.RELEASE_TO_VENDOR
              ? `The dispute on order #${dispute.order_reference} was settled in your favour. Your earnings for it are released.`
              : dto.resolution === DisputeResolution.PARTIAL_REFUND
                ? `The dispute on order #${dispute.order_reference} was settled with a partial refund of ₦${(dispute.refund_amount ?? 0).toLocaleString()} to the customer. ₦${vendorLoses.toLocaleString()} came out of your earnings for it; the rest is released.`
                : `The dispute on order #${dispute.order_reference} was settled with a full refund of ₦${(dispute.refund_amount ?? 0).toLocaleString()} to the customer. Your earnings for it (₦${vendorLoses.toLocaleString()}) were cancelled.`,
          metadata: {
            order_reference: dispute.order_reference,
            dispute_id: dispute._id,
            resolution: dto.resolution,
          },
          action_url: `/orders`,
        })
        .catch((err) =>
          this.logger.error(
            `Failed to notify vendor about resolution: ${err.message}`,
          ),
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
    // Exact amount, to the customer's wallet, however they paid. The gateway
    // refund used here before sent back the WHOLE original charge for a
    // partial (or single-vendor) resolution.
    await this.walletsService.refundToCustomerWallet({
      order,
      amount,
      reason: 'dispute_refund',
      description: `${reason} - order ${order.reference}`,
    });
    await this.orderModel.updateOne(
      { _id: order._id, refund_status: { $ne: 'refunded' } },
      { $set: { refund_status: 'partial' } },
    );
  }
}
