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
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { ProductService } from '../products/products.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
    private readonly businessService: BusinessService,
    private readonly productService: ProductService,

    @InjectModel('Order') private orderModel: Model<Order>,
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

      case 'charge.failed':
      case 'transfer.failed':
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
      transaction.wallet !== undefined;

    if (isWalletFunding) {
      await this.walletsService.creditWallet(
        transaction.wallet!.toString(),
        transaction.amount,
      );
    }

    const isCheckoutOrder =
      transaction.channel === 'checkout' && transaction.order !== undefined;

    if (isCheckoutOrder) {
      const orderId = transaction.order!._id;

      await this.orderModel.updateOne(
        { _id: orderId },
        { status: 'processing' },
      );

      await Promise.all([
        this.businessService.recordBusinessEarnings(orderId),
        this.productService.updateInventory(orderId),
      ]);
    }

    return isWalletFunding;
  }

  private async handleTransferSuccess(
    transaction: TransactionDocument,
  ): Promise<boolean> {
    transaction.status = TransactionStatus.SUCCESS;
    let walletUpdated = false;

    // Vendor payout
    if (
      transaction.type === TransactionType.CREDIT &&
      transaction.channel === 'payout'
    ) {
      await this.processVendorPayout(transaction);
    }

    // Wallet debit if applicable
    if (transaction.wallet && transaction.type === TransactionType.DEBIT) {
      await this.walletsService.debitWallet(
        transaction.wallet.toString(),
        transaction.amount,
      );
      walletUpdated = true;
    }

    return walletUpdated;
  }

  private async processVendorPayout(transaction: TransactionDocument) {
    const businessId = transaction.initiator as unknown as string;
    const business = await this.businessService.findBusinessById(businessId);
    if (!business) return;

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

    const trackingNumber =
      payload?.tracking_number ||
      payload?.data?.tracking_number ||
      payload?.shipment?.tracking_number;

    const newStatus =
      payload?.status ||
      payload?.data?.status ||
      payload?.shipment?.status;

    if (!trackingNumber) {
      this.logger.warn('Shipbubble webhook: no tracking_number found');
      return { status: 'ignored', message: 'No tracking number' };
    }

    // Find order with matching shipment tracking number
    const order = await this.orderModel.findOne({
      'shipments.tracking_number': trackingNumber,
    }) as OrderDocument;

    if (!order) {
      this.logger.warn(
        `Shipbubble webhook: no order found for tracking ${trackingNumber}`,
      );
      return { status: 'ignored', message: 'Order not found' };
    }

    // Find and update the specific shipment
    const shipmentIndex = order.shipments.findIndex(
      (s) => s.tracking_number === trackingNumber,
    );
    if (shipmentIndex === -1) {
      return { status: 'ignored', message: 'Shipment not found in order' };
    }

    // Map Shipbubble status to our ShipmentStatus
    const statusMap: Record<string, ShipmentStatus> = {
      in_transit: ShipmentStatus.IN_TRANSIT,
      delivered: ShipmentStatus.DELIVERED,
      failed: ShipmentStatus.FAILED,
      picked_up: ShipmentStatus.IN_TRANSIT,
      out_for_delivery: ShipmentStatus.IN_TRANSIT,
    };

    const mappedStatus =
      statusMap[newStatus?.toLowerCase()] || null;

    if (!mappedStatus) {
      this.logger.log(
        `Shipbubble webhook: unmapped status "${newStatus}" for ${trackingNumber}`,
      );
      return { status: 'ignored', message: `Unknown status: ${newStatus}` };
    }

    order.shipments[shipmentIndex].status = mappedStatus;

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

      // Set payout eligibility for each vendor (after delay period)
      // This can be enhanced with platform-specific payout_delay_days
      order.payout_eligible_at = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ); // 7 days default
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

    return {
      status: 'success',
      tracking_number: trackingNumber,
      shipment_status: mappedStatus,
      order_status: order.status,
    };
  }
}
