import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  TransactionDocument,
  TransactionStatus,
  TransactionType,
} from '../transactions/schema/transaction.schema';
import { BusinessService } from '../business/business.service';
import {
  Order,
  OrderDocument,
  OrderStatus,
  ShipmentStatus,
} from '../orders/schemas/orders.schema';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { ProductService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from '../business/schemas/business-earnings.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
    private readonly businessService: BusinessService,
    private readonly productService: ProductService,
    private readonly notificationsService: NotificationsService,

    @InjectModel('Order') private orderModel: Model<Order>,
    @InjectModel(BusinessEarning.name)
    private businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(PlatformSettings.name)
    private platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectModel('BespokeDesign') private bespokeDesignModel: Model<any>,
    @InjectModel('BespokeQuote') private bespokeQuoteModel: Model<any>,
  ) {}
  async handlePaystackWebhook(payload: any) {
    const { event, data } = payload;
    const transaction = await this.transactionService
      .findByReference(data.reference)
      .catch(() => null);

    if (!transaction)
      return { status: 'ignored', message: 'Transaction not found' };

    let walletUpdated = false;

    switch (event) {
      case 'charge.success':
        walletUpdated = await this.handleChargeSuccess(transaction);
        transaction.status = TransactionStatus.SUCCESS;
        break;

      case 'transfer.success':
        walletUpdated = await this.handleTransferSuccess(transaction);
        transaction.status = TransactionStatus.SUCCESS;
        break;

      case 'transfer.failed':
        await this.handleTransferFailed(transaction);
        transaction.status = TransactionStatus.FAILED;
        break;

      case 'charge.failed':
        transaction.status = TransactionStatus.FAILED;
        break;

      default:
        break;
    }

    transaction.metadata = {
      ...transaction.metadata,
      webhook: data,
      last_event: event,
      processed_at: new Date().toISOString(),
    };

    await transaction.save();

    return {
      status: 'success',
      received: true,
      reference: transaction.reference,
      walletUpdated,
    };
  }

  // ------------------------ Helpers ------------------------

  private async handleChargeSuccess(
    transaction: TransactionDocument,
  ): Promise<boolean> {
    transaction.status = TransactionStatus.SUCCESS;

    const isWalletFunding =
      transaction.type === TransactionType.FUND &&
      transaction.wallet != null;

    this.logger.log(
      `handleChargeSuccess: type=${transaction.type}, wallet=${transaction.wallet}, isWalletFunding=${isWalletFunding}`,
    );

    // Idempotency: Paystack retries webhooks. Credit a funded wallet only once.
    const alreadyCredited = (transaction.metadata as any)?.funding_credited === true;
    if (isWalletFunding && !alreadyCredited) {
      try {
        this.logger.log(
          `Crediting wallet ${transaction.wallet} with ${transaction.amount}`,
        );
        await this.walletsService.creditWallet(
          transaction.wallet!.toString(),
          transaction.amount,
        );
        // Flag persists via the metadata spread + save() in the caller.
        transaction.metadata = {
          ...(transaction.metadata as any),
          funding_credited: true,
        };
        this.logger.log(`Wallet ${transaction.wallet} credited successfully`);
      } catch (error) {
        this.logger.error(`Failed to credit wallet: ${error.message}`, error.stack);
      }
    } else if (isWalletFunding && alreadyCredited) {
      this.logger.warn(
        `Wallet funding ${transaction.reference} already credited — skipping.`,
      );
    }

    const isCheckoutOrder =
      transaction.channel === 'checkout' &&
      transaction.order != null;

    if (isCheckoutOrder) {
      try {
        const orderId = transaction.order!._id;
        const order = await this.orderModel.findById(orderId).lean();
        const isBespoke = (order as any)?.type === 'bespoke';

        // Bespoke: finalise the quote acceptance now that payment succeeded —
        // accept the winning quote, decline the alternatives and mark the design
        // accepted. (We deliberately DON'T do this at accept-time, so an
        // abandoned payment never leaves the customer stuck.)
        if (isBespoke && (order as any)?.bespoke_quote) {
          await this.finalizeBespokeAcceptance(order).catch((e: any) =>
            this.logger.error(`Failed to finalise bespoke acceptance: ${e?.message}`),
          );
        }

        // Bespoke orders are auto-confirmed: the tailor already committed by
        // quoting, so on payment they go straight to `processing` (no separate
        // vendor-confirm step) rather than `in_review`.
        await this.orderModel.updateOne(
          { _id: orderId },
          { status: isBespoke ? 'processing' : 'in_review', payment_status: 'paid' },
        );

        await Promise.all([
          this.businessService.recordBusinessEarnings(orderId),
          this.productService.updateInventory(orderId),
        ]);

        if (isBespoke) {
          // Release the tailor's UPFRONT milestone (funds materials). Earnings
          // were just recorded above, so schedule their release now — mirrors
          // what confirmVendorShipment does for custom clothing.
          await this.scheduleBespokeUpfront(order).catch((e: any) =>
            this.logger.error(`Failed to schedule bespoke upfront: ${e?.message}`),
          );
          // Move the design into production.
          if ((order as any)?.bespoke_design) {
            await this.bespokeDesignModel
              .updateOne(
                { _id: (order as any).bespoke_design },
                { $set: { status: 'in_production' } },
              )
              .catch((e: any) =>
                this.logger.error(
                  `Failed to move bespoke design to in_production: ${e?.message}`,
                ),
              );
          }
        }
      } catch (error) {
        this.logger.error(`Failed to process checkout order: ${error.message}`, error.stack);
      }
    }

    return isWalletFunding;
  }

  // Finalise a bespoke acceptance once payment has succeeded: accept the paid
  // quote, decline the sibling quotes on the same design, and point the design
  // at the accepted quote. Idempotent (safe on webhook retries).
  private async finalizeBespokeAcceptance(order: any) {
    const quoteId = order?.bespoke_quote;
    if (!quoteId) return;
    const quote = await this.bespokeQuoteModel.findById(quoteId);
    if (!quote || quote.status === 'accepted') return;

    quote.status = 'accepted';
    quote.accepted_at = new Date();
    await quote.save();

    await this.bespokeQuoteModel.updateMany(
      {
        design: quote.design,
        _id: { $ne: quote._id },
        status: { $in: ['pending', 'draft', 'submitted', 'revision_requested'] },
      },
      { $set: { status: 'declined' } },
    );

    await this.bespokeDesignModel.updateOne(
      { _id: quote.design },
      { $set: { accepted_quote: quote._id } },
    );
  }

  // Schedule the vendor's UPFRONT milestone earnings for a bespoke order so the
  // tailor gets funded to start (materials), instead of waiting for delivery.
  // Same payout-delay window as confirmVendorShipment.
  private async scheduleBespokeUpfront(order: any) {
    const settings = await this.platformSettingsModel.findOne().lean();
    const payoutDelayDays = (settings as any)?.payout_delay_days ?? 3;
    const releaseDate = new Date(
      Date.now() + payoutDelayDays * 24 * 60 * 60 * 1000,
    );
    const res = await this.businessEarningsModel.updateMany(
      {
        order: order._id,
        milestone: 'upfront',
        released: false,
        release_date: null,
      },
      { $set: { release_date: releaseDate } },
    );
    if (res.modifiedCount > 0) {
      this.logger.log(
        `[Bespoke] Scheduled ${res.modifiedCount} upfront earning(s) for order ${order.reference} — releasing ${releaseDate.toISOString()}`,
      );
    }
  }

  private async handleTransferSuccess(
    transaction: TransactionDocument,
  ): Promise<boolean> {
    transaction.status = TransactionStatus.SUCCESS;

    // Vendor payout. The wallet was ALREADY debited when the withdrawal was
    // requested (see WalletsService.requestWithdrawal, which debits up-front to
    // prevent double-withdrawal), so here we only finalize the payout
    // bookkeeping — we must NOT debit the wallet again. Match on channel, since
    // a payout is a DEBIT (money leaving the vendor's wallet).
    if (transaction.channel === 'payout') {
      await this.processVendorPayout(transaction);
      return true;
    }

    return false;
  }

  private async handleTransferFailed(
    transaction: TransactionDocument,
  ): Promise<void> {
    // A payout debits the wallet up-front at request time. If the transfer then
    // fails asynchronously, the funds must be returned to the vendor — exactly
    // once (Paystack retries webhooks), guarded by a metadata flag.
    const alreadyReversed =
      (transaction.metadata as any)?.payout_reversed === true;

    if (
      transaction.channel === 'payout' &&
      transaction.wallet &&
      !alreadyReversed
    ) {
      try {
        await this.walletsService.creditWallet(
          transaction.wallet.toString(),
          transaction.amount,
        );
        transaction.metadata = {
          ...(transaction.metadata as any),
          payout_reversed: true,
        };
        this.logger.log(
          `[Payout] transfer.failed — restored ₦${transaction.amount} to wallet ${transaction.wallet}`,
        );
      } catch (error) {
        this.logger.error(
          `[Payout] Failed to restore wallet on transfer.failed: ${error.message}`,
        );
      }
    }
  }

  private async processVendorPayout(transaction: TransactionDocument) {
    // The payout transaction stores the business id in metadata; `initiator` is
    // the owner's USER id (created_by.id), which is NOT a business id — resolving
    // by it returns null and silently skips all payout bookkeeping. Prefer
    // metadata.business_id, fall back to initiator for older records.
    const businessId =
      ((transaction.metadata as any)?.business_id as string) ??
      (transaction.initiator as unknown as string);
    const business = await this.businessService.findBusinessById(businessId);
    if (!business) {
      this.logger.warn(
        `[Payout] Could not resolve business for transaction ${transaction.reference}; skipping payout bookkeeping.`,
      );
      return;
    }

    // Compute vendor earnings

    business.lifetime_paid_out =
      (business.lifetime_paid_out || 0) + transaction.amount;
    business.pending_payout_balance = 0;
    business.last_payout_date = new Date();
    business.payout_history = business.payout_history || [];
    business.payout_history.push(transaction.reference);
    await business.save();

    await this.orderModel.updateMany(
      { 'items.business': business._id, payout_status: 'eligible' },
      { $set: { payout_status: 'paid' } },
    );
  }

  // -------------------- Shipbubble Webhook --------------------

  async handleShipbubbleWebhook(payload: any) {
    this.logger.log(`Shipbubble webhook received: ${JSON.stringify(payload)}`);

    // Shipbubble identifies a shipment by `order_id` (e.g. "SB-244512FE8276")
    // and carries the courier tracking code under `courier.tracking_code`.
    // Collect every identifier the payload might use (across the flat / data /
    // shipment shapes) so we can match whatever we stored at fulfillment.
    const candidates = [
      payload?.order_id,
      payload?.data?.order_id,
      payload?.shipment?.order_id,
      payload?.tracking_number,
      payload?.data?.tracking_number,
      payload?.shipment?.tracking_number,
      payload?.courier?.tracking_code,
      payload?.data?.courier?.tracking_code,
      payload?.shipment?.courier?.tracking_code,
    ]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim());

    const newStatus =
      payload?.status ||
      payload?.status_code ||
      payload?.data?.status ||
      payload?.shipment?.status;

    if (candidates.length === 0) {
      this.logger.warn('Shipbubble webhook: no shipment identifier found');
      return { status: 'ignored', message: 'No shipment identifier' };
    }

    // Match on EITHER the stored Shipbubble order id (shipment_id) or the
    // tracking number.
    const order = (await this.orderModel.findOne({
      $or: [
        { 'shipments.shipment_id': { $in: candidates } },
        { 'shipments.tracking_number': { $in: candidates } },
      ],
    })) as OrderDocument;

    if (!order) {
      this.logger.warn(
        `Shipbubble webhook: no order found for ${candidates.join(', ')}`,
      );
      return { status: 'ignored', message: 'Order not found' };
    }

    const shipmentIndex = order.shipments.findIndex(
      (s) =>
        (s.shipment_id && candidates.includes(s.shipment_id)) ||
        (s.tracking_number && candidates.includes(s.tracking_number)),
    );
    if (shipmentIndex === -1) {
      return { status: 'ignored', message: 'Shipment not found in order' };
    }

    // Map Shipbubble status codes to our ShipmentStatus. Shipbubble uses:
    // pending | confirmed | picked_up | in_transit | completed | cancelled.
    const statusMap: Record<string, ShipmentStatus> = {
      picked_up: ShipmentStatus.IN_TRANSIT,
      in_transit: ShipmentStatus.IN_TRANSIT,
      out_for_delivery: ShipmentStatus.IN_TRANSIT,
      completed: ShipmentStatus.DELIVERED,
      delivered: ShipmentStatus.DELIVERED,
      cancelled: ShipmentStatus.FAILED,
      failed: ShipmentStatus.FAILED,
      // 'pending' / 'confirmed' carry no shipment-status change for us.
    };

    const mappedStatus = statusMap[String(newStatus).toLowerCase()] || null;

    if (!mappedStatus) {
      this.logger.log(
        `Shipbubble webhook: no-op status "${newStatus}" for ${candidates[0]}`,
      );
      return { status: 'ignored', message: `Unhandled status: ${newStatus}` };
    }

    order.shipments[shipmentIndex].status = mappedStatus;
    const trackingNumber =
      order.shipments[shipmentIndex].tracking_number || candidates[0];

    if (mappedStatus === ShipmentStatus.DELIVERED) {
      order.shipments[shipmentIndex].delivered_at = new Date();
    }

    // Check if ALL shipments are delivered → complete the order
    const allDelivered = order.shipments.every(
      (s, i) =>
        i === shipmentIndex
          ? mappedStatus === ShipmentStatus.DELIVERED
          : s.status === ShipmentStatus.DELIVERED,
    );

    if (allDelivered) {
      order.status = OrderStatus.COMPLETED;
      this.logger.log(
        `All shipments delivered for order ${order.reference} — marking COMPLETED`,
      );

      // Set delivery-gated payout: release_date = now + payout_delay_days
      const settings = await this.platformSettingsModel.findOne().lean();
      const payoutDelayDays = (settings as any)?.payout_delay_days ?? 3;
      const releaseDate = new Date(
        Date.now() + payoutDelayDays * 24 * 60 * 60 * 1000,
      );

      // Update all unreleased earnings for this order with the release date
      const updateResult = await this.businessEarningsModel.updateMany(
        { order: order._id, released: false, release_date: null },
        { $set: { release_date: releaseDate } },
      );

      this.logger.log(
        `[DeliveryPayout] Set release_date to ${releaseDate.toISOString()} for ${updateResult.modifiedCount} earning(s) on order ${order.reference}`,
      );

      // Update order-level payout tracking
      order.payout_eligible_at = releaseDate;
      order.payout_status = 'eligible';
    } else if (
      order.shipments.some(
        (s) =>
          s.status === ShipmentStatus.IN_TRANSIT ||
          s.status === ShipmentStatus.SHIPPED,
      )
    ) {
      order.status = OrderStatus.IN_TRANSIT;
    }

    await order.save();

    // ── Notify customer about delivery status ──
    this.notifyCustomerShippingUpdate(order, mappedStatus, trackingNumber).catch((err) =>
      this.logger.error('Failed to send customer shipping notification', err),
    );

    return {
      status: 'success',
      tracking_number: trackingNumber,
      shipment_status: mappedStatus,
      order_status: order.status,
    };
  }

  /**
   * Send customer notifications for shipping status changes.
   */
  private async notifyCustomerShippingUpdate(
    order: OrderDocument,
    status: ShipmentStatus,
    trackingNumber: string,
  ) {
    const customerId = order.customer?.toString();
    if (!customerId) return;

    let title: string;
    let body: string;
    let type: NotificationType;

    switch (status) {
      case ShipmentStatus.IN_TRANSIT:
        title = 'Your order is on its way! 🚚';
        body = `Order #${order.reference} is now in transit. Tracking: ${trackingNumber}`;
        type = NotificationType.ORDER_SHIPPED;
        break;
      case ShipmentStatus.DELIVERED:
        title = 'Order delivered! ✅';
        body = `Order #${order.reference} has been delivered. Enjoy your purchase!`;
        type = NotificationType.ORDER_DELIVERED;
        break;
      case ShipmentStatus.FAILED:
        title = 'Delivery issue ⚠️';
        body = `There was a problem delivering order #${order.reference}. We're looking into it.`;
        type = NotificationType.ORDER_STATUS_CHANGED;
        break;
      default:
        return;
    }

    await this.notificationsService.create({
      recipient: customerId,
      category: NotificationCategory.SHIPPING,
      type,
      title,
      body,
      metadata: {
        order_id: order._id,
        order_reference: order.reference,
        tracking_number: trackingNumber,
        shipment_status: status,
      },
      action_url: `/orders`,
    });
  }
}
