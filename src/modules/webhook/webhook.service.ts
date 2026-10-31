import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StripeProvider } from '../payment-providers/stripe.provider';
import { buildPurchaseEvents } from '../recommendations/events/purchase-events.util';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import { TokenService } from '../wallets/token.service';
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
import { PaymentService } from '../payment/payment.service';
import { NairaGatewayService } from '../payment/naira-gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../notifications/mail/mail.service';
import { EmailStatus } from '../notifications/schemas/email-log.schema';
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
    private readonly tokenService: TokenService,
    private readonly businessService: BusinessService,
    private readonly productService: ProductService,
    private readonly paymentService: PaymentService,
    private readonly nairaGateway: NairaGatewayService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly stripeProvider: StripeProvider,

    @InjectModel('Order') private orderModel: Model<Order>,
    @InjectModel(BusinessEarning.name)
    private businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(PlatformSettings.name)
    private platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectModel('BespokeDesign') private bespokeDesignModel: Model<any>,
    @InjectModel('BespokeQuote') private bespokeQuoteModel: Model<any>,
    @InjectModel('Business') private businessModel: Model<any>,
    @InjectModel('Event') private eventModel: Model<any>,
    @InjectModel('FabricReservation')
    private fabricReservationModel: Model<any>,
    @InjectModel('FabricClaim') private fabricClaimModel: Model<any>,
  ) {}

  /**
   * Notify the vendor whose shipment changed status. The customer already gets
   * their own update; this is the vendor-facing 'Shipping' notification.
   */
  private async notifyVendorShippingUpdate(
    order: OrderDocument,
    shipment: any,
    status: ShipmentStatus,
    trackingNumber: string,
  ) {
    try {
      if (
        status !== ShipmentStatus.IN_TRANSIT &&
        status !== ShipmentStatus.DELIVERED
      )
        return;

      const business = await this.businessModel
        .findById(shipment?.business)
        .select('created_by')
        .lean();
      const recipient = (business as any)?.created_by?.id?.toString();
      if (!recipient) return;

      const delivered = status === ShipmentStatus.DELIVERED;
      await this.notificationsService.create({
        recipient,
        recipient_business: shipment?.business?.toString?.() ?? shipment?.business,
        category: NotificationCategory.SHIPPING,
        type: delivered
          ? NotificationType.ORDER_DELIVERED
          : NotificationType.ORDER_SHIPPED,
        title: delivered ? 'Order delivered ✅' : 'Order in transit 🚚',
        body: delivered
          ? `Your shipment for order #${order.reference} was delivered. Payout will be scheduled shortly.`
          : `Your shipment for order #${order.reference} is on its way. Tracking: ${trackingNumber}`,
        metadata: {
          order_id: order._id,
          order_reference: order.reference,
          tracking_number: trackingNumber,
          shipment_status: status,
        },
        action_url: '/orders',
      });
    } catch (err: any) {
      this.logger.warn(`Failed to send vendor shipping notification: ${err.message}`);
    }
  }
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

  /**
   * Stripe events (multi-currency plan Phase 3). The ledger transaction
   * reference rides on the Checkout Session's client_reference_id (and the
   * PaymentIntent's metadata.reference), so completion funnels into the SAME
   * idempotent path as Paystack's charge.success — finalizeCheckoutOrder is
   * safe against the duplicate session/PI success events Stripe can send.
   */
  async handleStripeWebhook(event: any) {
    const type: string = event?.type ?? '';
    const obj: any = event?.data?.object ?? {};
    const reference: string | undefined =
      obj?.client_reference_id || obj?.metadata?.reference;
    if (!reference) return { status: 'ignored', message: 'No reference' };

    const transaction = await this.transactionService
      .findByReference(reference)
      .catch(() => null);
    if (!transaction)
      return { status: 'ignored', message: 'Transaction not found' };

    switch (type) {
      case 'checkout.session.completed':
      case 'payment_intent.succeeded':
        await this.handleChargeSuccess(transaction);
        transaction.status = TransactionStatus.SUCCESS;
        break;

      case 'payment_intent.payment_failed':
        transaction.status = TransactionStatus.FAILED;
        break;

      default:
        break;
    }

    transaction.metadata = {
      ...transaction.metadata,
      stripe_event: type,
      processed_at: new Date().toISOString(),
    };
    await transaction.save();

    return { status: 'success', received: true, reference };
  }

  /**
   * Flutterwave events. The body is only a hint: a charge is re-checked with
   * Flutterwave (amount and currency included) before anything is settled,
   * then it runs through the same idempotent success path as Paystack.
   *   charge.completed   → card payment (data.tx_ref = our reference)
   *   transfer.completed → vendor payout (data.reference = our reference)
   */
  async handleFlutterwaveWebhook(payload: any) {
    const event: string = payload?.event ?? payload?.type ?? '';
    const data: any = payload?.data ?? {};

    if (event === 'charge.completed') {
      const reference: string | undefined = data.tx_ref;
      if (!reference) return { status: 'ignored', message: 'No reference' };
      const exists = await this.transactionService
        .findByReference(reference)
        .catch(() => null);
      if (!exists) return { status: 'ignored', message: 'Transaction not found' };

      await this.nairaGateway.verify(reference, 'flutterwave');
      // Reload: verify settled the row atomically, and saving the stale copy
      // would undo that.
      const transaction = await this.transactionService.findByReference(reference);
      if (transaction.status === TransactionStatus.SUCCESS) {
        await this.handleChargeSuccess(transaction);
      }
      transaction.metadata = {
        ...(transaction.metadata as any),
        flutterwave_event: event,
        processed_at: new Date().toISOString(),
      };
      await transaction.save();
      return { status: 'success', received: true, reference };
    }

    if (event === 'transfer.completed') {
      const reference: string | undefined = data.reference;
      if (!reference) return { status: 'ignored', message: 'No reference' };
      const transaction = await this.transactionService
        .findByReference(reference)
        .catch(() => null);
      if (!transaction) return { status: 'ignored', message: 'Transaction not found' };

      const outcome = String(data.status || '').toUpperCase();
      // Flutterwave retries; a payout already settled either way is left alone.
      const settled =
        transaction.status === TransactionStatus.SUCCESS ||
        transaction.status === TransactionStatus.FAILED;
      if (!settled && outcome === 'SUCCESSFUL') {
        await this.handleTransferSuccess(transaction);
        transaction.status = TransactionStatus.SUCCESS;
      } else if (!settled && outcome === 'FAILED') {
        await this.handleTransferFailed(transaction);
        transaction.status = TransactionStatus.FAILED;
      }
      transaction.metadata = {
        ...(transaction.metadata as any),
        flutterwave_event: event,
        flutterwave_transfer_status: outcome,
        processed_at: new Date().toISOString(),
      };
      await transaction.save();
      return { status: 'success', received: true, reference };
    }

    return { status: 'ignored', message: `Unhandled event ${event}` };
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

    // Idempotency: providers retry webhooks, and the customer's return page
    // (/wallets/verify) credits too. One atomic flag decides who credits.
    if (isWalletFunding) {
      const first = await this.transactionService
        .claimMetadataFlag(transaction.reference, 'funding_credited')
        .catch(() => false);
      if (first) {
        try {
          this.logger.log(
            `Crediting wallet ${transaction.wallet} with ${transaction.amount}`,
          );
          await this.walletsService.creditWallet(
            transaction.wallet!.toString(),
            transaction.amount,
          );
          this.logger.log(`Wallet ${transaction.wallet} credited successfully`);
        } catch (error) {
          this.logger.error(`Failed to credit wallet: ${error.message}`, error.stack);
          // Release the flag so a webhook retry or the return page can credit.
          await this.transactionService
            .attachMetadata(transaction.reference, { funding_credited: false })
            .catch(() => undefined);
          transaction.metadata = {
            ...(transaction.metadata as any),
            funding_credited: false,
          };
          return isWalletFunding;
        }
      } else {
        this.logger.warn(
          `Wallet funding ${transaction.reference} already credited — skipping.`,
        );
      }
      // Keep the flag when the caller saves this (possibly stale) document.
      transaction.metadata = {
        ...(transaction.metadata as any),
        funding_credited: true,
      };
    }

    const isCheckoutOrder =
      transaction.channel === 'checkout' &&
      transaction.order != null;

    if (isCheckoutOrder) {
      await this.finalizeCheckoutOrder(transaction).catch((error) =>
        this.logger.error(
          `Failed to process checkout order: ${error.message}`,
          error.stack,
        ),
      );
    }

    // Fabric-reservation FEE settled: activate the reservation. The fee is
    // platform revenue — no earnings, no inventory (yards were locked at
    // creation) — so it must NOT go through finalizeCheckoutOrder.
    if (transaction.channel === 'reservation') {
      await this.finalizeReservationFee(transaction).catch((error) =>
        this.logger.error(
          `Failed to finalize reservation fee: ${error.message}`,
          error.stack,
        ),
      );
    }

    return isWalletFunding;
  }

  /**
   * Mark a fabric reservation live once its fee payment settles: flag the
   * reservation fee_paid (guests can only claim from paid reservations, and
   * the unpaid-holds cron cancels reservations that never pay), and close out
   * the fee order so it doesn't linger as "pending" in the customer's history.
   * Idempotent — safe on webhook retries.
   */
  private async finalizeReservationFee(transaction: TransactionDocument) {
    const reservationId = (transaction.metadata as any)?.reservation_id;
    if (reservationId) {
      await this.fabricReservationModel.updateOne(
        { _id: reservationId, fee_paid: { $ne: true } },
        { $set: { fee_paid: true } },
      );
    }
    if (transaction.order) {
      await this.orderModel.updateOne(
        { _id: transaction.order._id ?? transaction.order },
        { $set: { status: 'completed', payment_status: 'paid' } },
      );
    }
    this.logger.log(
      `Reservation fee settled for reservation ${reservationId ?? '(unknown)'} — reservation activated`,
    );
  }

  /**
   * Finalise a paid card-checkout order: mark it paid, record vendor earnings,
   * deduct inventory, and (for bespoke) accept the quote + schedule the upfront
   * milestone + move the design into production.
   *
   * Idempotent — safe to call from BOTH the Paystack webhook AND the
   * customer-return verify endpoint. recordBusinessEarnings and updateInventory
   * are each individually idempotent; the bespoke side effects (which are not)
   * only run on the FIRST finalisation, i.e. when the order wasn't already paid.
   */
  /**
   * The charge for an already-cancelled order settled: credit it back to the
   * customer's wallet, record the REFUND, mark the order refunded and tell
   * them. Never throws - the webhook must still be acknowledged.
   */
  private async refundPaymentOnCancelledOrder(
    order: any,
    transaction: TransactionDocument,
  ): Promise<void> {
    const amount = transaction.amount || 0;
    const customerId = order.customer?.toString();
    try {
      if (!customerId || amount <= 0) {
        throw new Error(customerId ? 'non-positive amount' : 'order has no customer');
      }
      const wallet = await this.walletsService.getOrCreateWallet({ customer: customerId });
      const walletId = String((wallet as any)._id);
      await this.walletsService.creditWallet(walletId, amount);
      await this.transactionService.create({
        initiator: order.customer,
        order: order._id,
        wallet: (wallet as any)._id,
        type: TransactionType.REFUND,
        amount,
        status: TransactionStatus.SUCCESS,
        description: `Refund for cancelled order ${order.reference}: payment settled after cancellation`,
        channel: 'refund',
        metadata: {
          order_reference: order.reference,
          original_transaction: transaction.reference,
          refund_type: 'wallet_from_paystack',
          reason: 'paid_after_cancel',
        },
      });
      await this.orderModel.updateOne(
        { _id: order._id },
        { $set: { refund_status: 'refunded' } },
      );
      this.logger.warn(
        `[Finalize] Order ${order.reference} was paid AFTER being cancelled - ₦${amount} credited back to the customer's wallet.`,
      );
      await this.notificationsService.create({
        recipient: customerId,
        audience: 'customer',
        category: NotificationCategory.ORDER,
        type: NotificationType.ORDER_CANCELLED,
        title: 'Payment Refunded',
        body: `Your payment for order #${order.reference} arrived after you cancelled it. ₦${amount.toLocaleString()} has been refunded to your wallet.`,
        metadata: {
          order_id: order._id,
          order_reference: order.reference,
          refund_amount: amount,
          reason: 'paid_after_cancel',
        },
        action_url: `/orders`,
      });
    } catch (error: any) {
      this.logger.error(
        `[Finalize] Order ${order.reference} was paid after cancellation but the refund did not complete: ${error?.message} - the reconciliation cron will retry.`,
      );
    }
  }

  async finalizeCheckoutOrder(transaction: TransactionDocument): Promise<void> {
    if (transaction.channel !== 'checkout' || transaction.order == null) return;

    const orderId = transaction.order._id;
    const order = await this.orderModel.findById(orderId).lean();
    if (!order) return;

    const isBespoke = (order as any)?.type === 'bespoke';
    const alreadyPaid = (order as any)?.payment_status === 'paid';

    // The customer cancelled BEFORE the payment settled (a card checkout
    // creates the order first; cancelling a pending order is allowed, and at
    // that moment there was no successful charge to refund). The status
    // guard below already kept such an order cancelled, but earnings were
    // still recorded, stock still deducted and the money kept - the vendor
    // showed held earnings on a cancelled order and the customer was never
    // refunded. Record the payment, send it straight back, and do nothing
    // else. Claimed atomically so a webhook + verify race cannot refund twice.
    if ((order as any)?.status === OrderStatus.CANCELLED) {
      const claim = await this.orderModel.updateOne(
        { _id: orderId, status: OrderStatus.CANCELLED, payment_status: { $ne: 'paid' } },
        { $set: { payment_status: 'paid' } },
      );
      if (claim.modifiedCount === 1) {
        await this.refundPaymentOnCancelledOrder(order as any, transaction);
      }
      return;
    }

    // Bespoke: finalise the quote acceptance now that payment succeeded — accept
    // the winning quote, decline the alternatives and mark the design accepted.
    // (Done at payment-time, not accept-time, so an abandoned payment never
    // leaves the customer stuck.) Skip if already finalised.
    if (!alreadyPaid && isBespoke && (order as any)?.bespoke_quote) {
      await this.finalizeBespokeAcceptance(order).catch((e: any) =>
        this.logger.error(`Failed to finalise bespoke acceptance: ${e?.message}`),
      );
    }

    // Bespoke orders are auto-confirmed: the tailor already committed by
    // quoting, so on payment they go straight to `processing` (no separate
    // vendor-confirm step) rather than `in_review`.
    //
    // Both writes are guarded so REPEAT finalisations (webhook retries, the
    // customer refreshing the verify page) never clobber the order's current
    // lifecycle status — an order the customer has since cancelled (or that
    // has moved on to shipping) must stay where it is.
    if (!alreadyPaid) {
      // Record the payment itself regardless of the order's state.
      await this.orderModel.updateOne(
        { _id: orderId },
        { payment_status: 'paid' },
      );
      // Move into fulfilment only from the pre-payment state.
      await this.orderModel.updateOne(
        { _id: orderId, status: 'pending' },
        { status: isBespoke ? 'processing' : 'in_review' },
      );
    }

    // Recommender purchase signal — FIRST finalisation only (webhook retries
    // and the verify safety-net both land here; alreadyPaid dedupes them).
    // Fire-and-forget: the signal must never block order finalisation.
    if (!alreadyPaid) {
      const purchaseEvents = buildPurchaseEvents(order);
      if (purchaseEvents.length) {
        this.eventModel
          .insertMany(purchaseEvents, { ordered: false })
          .catch((e: any) =>
            this.logger.warn(`Failed to record purchase events: ${e?.message}`),
          );
      }

      // Order-payment token reward (admin-tunable, 0 = off) — first
      // finalisation only, so webhook retries and the verify safety-net can't
      // double-credit. Fire-and-forget: never blocks finalisation.
      this.grantOrderPaymentReward(order).catch((e: any) =>
        this.logger.warn(
          `Order token reward failed for ${(order as any)?.reference}: ${e?.message}`,
        ),
      );
    }

    // Reservation claims: the claimed yards were deducted from the fabric when
    // the ORGANIZER's reservation locked them — running updateInventory here
    // would deduct the same yards a second time. Earnings still record (the
    // fabric vendor is paid for claimed yards), and the claim itself is marked
    // paid so the unpaid-holds cron leaves it alone.
    const isReservationClaim = (order as any)?.type === 'reservation_claim';

    // Post-payment side effects must NEVER fail the finalisation: the money is
    // already taken, so an inventory deficit (stock moved between checkout and
    // settlement — e.g. a reservation locked the yards, or counter drift) is a
    // reconciliation problem for the vendor, not a reason to strand a paid
    // customer on an endless "Payment not confirmed" loop. Log loudly and flag
    // the order instead.
    await Promise.all([
      this.businessService
        .recordBusinessEarnings(orderId)
        .catch((error: any) =>
          this.logger.error(
            `[Finalize] recordBusinessEarnings failed for order ${orderId}: ${error?.message}`,
          ),
        ),
      (isReservationClaim
        ? this.fabricClaimModel.updateOne(
            { order: orderId },
            { $set: { paid: true } },
          )
        : this.productService.updateInventory(orderId)
      ).catch(async (error: any) => {
        this.logger.error(
          `[Finalize] Inventory/claim settlement failed for PAID order ${orderId}: ${error?.message} — order stays paid; flagging for reconciliation.`,
        );
        await this.orderModel
          .updateOne(
            { _id: orderId },
            { $set: { inventory_deduction_failed: true } },
          )
          .catch(() => undefined);
      }),
    ]);

    if (!alreadyPaid && isBespoke) {
      // Release the tailor's UPFRONT milestone (funds materials).
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
  }

  /**
   * Order-payment token reward: a flat, admin-tunable token credit to the
   * customer each time an order settles as paid. Called only on the FIRST
   * finalisation (the `alreadyPaid` guard upstream dedupes webhook retries and
   * the verify safety-net).
   */
  private async grantOrderPaymentReward(order: any) {
    const customerId = order?.customer?.toString();
    if (!customerId) return;

    const settings = await this.platformSettingsModel.findOne().lean();
    const reward = (settings as any)?.order_payment_token_reward ?? 0;
    if (!reward || reward <= 0) return;

    await this.tokenService.grant({ customer: customerId }, reward, 'reward:order_payment', {
      order: order?.reference,
    });
    this.logger.log(
      `Granted ${reward} order-payment tokens to customer ${customerId} for ${order?.reference}`,
    );
  }

  /**
   * Customer-return verification. The Paystack webhook is the primary way a card
   * payment is finalised, but it can fail to arrive (misconfigured URL, downtime,
   * retries exhausted). When the customer lands back on the confirmation page we
   * actively confirm the charge with Paystack and finalise the order ourselves —
   * a safety net so earnings/inventory register even without the webhook.
   * Idempotent; a no-op if the webhook already did the work.
   */
  async verifyAndFinalize(
    reference: string,
  ): Promise<{ success: boolean; status: string }> {
    const transaction =
      await this.transactionService.findByReference(reference);

    // Wallet checkout is settled at creation and never goes through Paystack —
    // report its stored status without hitting the gateway (verifying a
    // non-Paystack reference would wrongly mark it failed). Reservation fees
    // ARE Paystack charges though, so they get the same active-verify safety
    // net as card checkout: without it the organizer's confirmation page could
    // only succeed if the webhook happened to land within its polling window.
    // Wallet top-ups are card charges too (Paystack or Flutterwave): confirm
    // with the provider when the webhook hasn't landed yet, then credit
    // through the same once-only path the webhook uses.
    if (
      transaction.channel === 'wallet_topup' &&
      transaction.status !== TransactionStatus.SUCCESS
    ) {
      await this.nairaGateway.verify(reference).catch((e: any) =>
        this.logger.error(
          `[VerifyAndFinalize] Top-up verify failed for ${reference}: ${e?.message}`,
        ),
      );
      const topUp = await this.transactionService.findByReference(reference);
      if (topUp.status === TransactionStatus.SUCCESS) {
        await this.handleChargeSuccess(topUp);
        await topUp.save();
        return { success: true, status: 'success' };
      }
      return { success: false, status: topUp.status };
    }

    if (
      transaction.channel !== 'checkout' &&
      transaction.channel !== 'reservation'
    ) {
      return {
        success: transaction.status === TransactionStatus.SUCCESS,
        status: transaction.status,
      };
    }

    if (transaction.channel === 'reservation') {
      if (transaction.status !== TransactionStatus.SUCCESS) {
        // Verify with the processor that actually charged — a Stripe fee
        // verified via Paystack would be wrongly marked failed.
        const isStripeFee =
          (transaction.metadata as any)?.payment_method === 'stripe';
        if (isStripeFee) {
          const check = await this.stripeProvider
            .verifyCharge(
              reference,
              (transaction.metadata as any)?.stripe_session_id,
            )
            .catch((e: any) => {
              this.logger.error(
                `[VerifyAndFinalize] Reservation-fee Stripe verify failed for ${reference}: ${e?.message}`,
              );
              return null;
            });
          if (check?.paid) {
            await this.transactionService.markSuccess(reference);
          }
        } else {
          await this.nairaGateway
            .verify(reference)
            .catch((e: any) =>
              this.logger.error(
                `[VerifyAndFinalize] Reservation-fee verify failed for ${reference}: ${e?.message}`,
              ),
            );
        }
      }
      const settled = await this.transactionService.findByReference(reference);
      if (settled.status === TransactionStatus.SUCCESS) {
        await this.finalizeReservationFee(settled).catch((e: any) =>
          this.logger.error(
            `[VerifyAndFinalize] Reservation-fee finalize failed: ${e?.message}`,
          ),
        );
        return { success: true, status: 'success' };
      }
      return { success: false, status: settled.status };
    }

    // Card checkout: confirm with the processor that charged if not settled.
    if (transaction.status !== TransactionStatus.SUCCESS) {
      const isStripe =
        (transaction.metadata as any)?.payment_method === 'stripe';
      if (isStripe) {
        // Stripe reference — verifying via Paystack would wrongly fail it.
        const check = await this.stripeProvider
          .verifyCharge(
            reference,
            (transaction.metadata as any)?.stripe_session_id,
          )
          .catch((e: any) => {
            this.logger.error(
              `[VerifyAndFinalize] Stripe verify failed for ${reference}: ${e?.message}`,
            );
            return null;
          });
        if (check?.paid) {
          await this.transactionService.markSuccess(reference);
        }
      } else {
        await this.nairaGateway
          .verify(reference)
          .catch((e: any) =>
            this.logger.error(
              `[VerifyAndFinalize] Card verify failed for ${reference}: ${e?.message}`,
            ),
          );
      }
    }

    const fresh = await this.transactionService.findByReference(reference);
    if (fresh.status === TransactionStatus.SUCCESS) {
      // The charge settled — that is what "verified" means to the customer.
      // A finalisation hiccup (e.g. inventory deficit) must not turn into a
      // 4xx that loops the confirmation page forever; it is logged/flagged
      // inside finalizeCheckoutOrder and reconciled by the vendor.
      await this.finalizeCheckoutOrder(fresh).catch((error: any) =>
        this.logger.error(
          `[VerifyAndFinalize] Finalisation failed for PAID ${reference}: ${error?.message}`,
        ),
      );
      return { success: true, status: 'success' };
    }
    return { success: false, status: fresh.status };
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
    // Load a real Mongoose document. businessService.findBusinessById returns an
    // aggregate result (a plain object with no .save()), so the payout
    // bookkeeping below used to throw and never persist — lifetime_paid_out /
    // payout_history were silently lost and orders never marked paid.
    const business = await this.businessModel.findById(businessId);
    if (!business) {
      this.logger.warn(
        `[Payout] Could not resolve business for transaction ${transaction.reference}; skipping payout bookkeeping.`,
      );
      return;
    }

    business.lifetime_paid_out =
      (business.lifetime_paid_out || 0) + transaction.amount;
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

    const rawStatus = String(newStatus ?? '').toLowerCase();
    const mappedStatus = statusMap[rawStatus] || null;

    if (!mappedStatus) {
      this.logger.log(
        `Shipbubble webhook: no-op status "${newStatus}" for ${candidates[0]}`,
      );
      return { status: 'ignored', message: `Unhandled status: ${newStatus}` };
    }

    const shipment: any = order.shipments[shipmentIndex];
    const previousStatus = shipment.status;
    const events: any[] = shipment.tracking_events ?? [];
    const lastEvent = events[events.length - 1];
    // Couriers re-send the same state; the timeline and the customer's
    // notifications only move when the state actually changes.
    const isNewEvent = lastEvent?.status !== rawStatus;
    if (isNewEvent) {
      const when = new Date(
        payload?.updated_at ?? payload?.data?.updated_at ?? payload?.timestamp ?? Date.now(),
      );
      const message =
        payload?.description ?? payload?.data?.description ?? payload?.message ?? null;
      shipment.tracking_events = [
        ...events,
        {
          status: rawStatus,
          at: isNaN(when.getTime()) ? new Date() : when,
          message: typeof message === 'string' ? message.slice(0, 200) : null,
        },
      ];
    }
    const trackingUrl =
      payload?.tracking_url ?? payload?.data?.tracking_url ?? payload?.shipment?.tracking_url;
    if (typeof trackingUrl === 'string' && /^https:\/\//i.test(trackingUrl)) {
      shipment.tracking_url = trackingUrl;
    }

    order.shipments[shipmentIndex].status = mappedStatus;
    const trackingNumber =
      order.shipments[shipmentIndex].tracking_number || candidates[0];

    if (mappedStatus === ShipmentStatus.DELIVERED && previousStatus !== ShipmentStatus.DELIVERED) {
      const deliveredAt = new Date();
      order.shipments[shipmentIndex].delivered_at = deliveredAt;

      // Per-parcel payout: THIS vendor's earnings start their countdown when
      // THEIR parcel arrives. Waiting for the whole order made a vendor who
      // delivered on time wait for every other vendor on the order. The
      // countdown is the longer of the payout delay and the return window,
      // and returns are now counted from this same delivery, so a return
      // can never arrive after the money it would claw back was released.
      // Upfront milestones are already scheduled; held (disputed) rows are
      // re-held by the release job.
      const settings = await this.platformSettingsModel.findOne().lean();
      const holdDays = Math.max(
        (settings as any)?.payout_delay_days ?? 3,
        (settings as any)?.return_window_days ?? 7,
      );
      const releaseDate = new Date(deliveredAt.getTime() + holdDays * 86400000);
      const vendorId = (order.shipments[shipmentIndex] as any).business;
      if (vendorId) {
        const scheduled = await this.businessEarningsModel.updateMany(
          { order: order._id, business: vendorId, released: false, release_date: null },
          { $set: { release_date: releaseDate } },
        );
        this.logger.log(
          `[DeliveryPayout] Parcel delivered on ${order.reference}: ${scheduled.modifiedCount} earning(s) for vendor ${vendorId} release ${releaseDate.toISOString()}`,
        );
      }
    }

    // Check if ALL shipments are delivered → complete the order. A vendor
    // who declined their part ships nothing, so their shipment never counts
    // against completion (it used to hold the order open forever).
    const allDelivered = order.shipments.every(
      (s: any, i) =>
        s.rejected ||
        (i === shipmentIndex
          ? mappedStatus === ShipmentStatus.DELIVERED
          : s.status === ShipmentStatus.DELIVERED),
    );

    if (allDelivered) {
      order.status = OrderStatus.COMPLETED;
      this.logger.log(
        `All shipments delivered for order ${order.reference} — marking COMPLETED`,
      );

      // Set delivery-gated payout: release_date = now + the longer of the
      // payout delay and the return window. Releasing on day 3 of a 7-day
      // return window let a vendor withdraw money a day-6 return then could
      // not claw back.
      const settings = await this.platformSettingsModel.findOne().lean();
      const payoutDelayDays = Math.max(
        (settings as any)?.payout_delay_days ?? 3,
        (settings as any)?.return_window_days ?? 7,
      );
      const releaseDate = new Date(
        Date.now() + payoutDelayDays * 24 * 60 * 60 * 1000,
      );

      // Fallback: anything still undated on a fully delivered order (rows
      // without a vendor shipment, older data). Each vendor's own rows were
      // dated when their parcel arrived.
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

      // A delivered bespoke order completes its design — otherwise My Designs
      // shows "in production" forever after the garment has arrived.
      if ((order as any).bespoke_design) {
        await this.bespokeDesignModel
          .updateOne(
            { _id: (order as any).bespoke_design },
            { $set: { status: 'completed' } },
          )
          .catch((e: any) =>
            this.logger.error(
              `Failed to complete bespoke design for order ${order.reference}: ${e?.message}`,
            ),
          );
      }
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

    // Notify only when something changed: a repeated "in_transit" used to
    // send "Your order is on its way!" again every time.
    if (mappedStatus !== previousStatus) {
      // ── Notify the vendor whose shipment moved ──
      this.notifyVendorShippingUpdate(
        order,
        order.shipments[shipmentIndex],
        mappedStatus,
        trackingNumber,
      ).catch((err) =>
        this.logger.error('Failed to send vendor shipping notification', err),
      );

      // ── Notify customer about delivery status ──
      this.notifyCustomerShippingUpdate(order, mappedStatus, trackingNumber).catch((err) =>
        this.logger.error('Failed to send customer shipping notification', err),
      );
    } else if (rawStatus === 'out_for_delivery' && isNewEvent) {
      // The one in-transit step worth its own message.
      this.notificationsService
        .create({
          recipient: order.customer?.toString(),
          audience: 'customer',
          category: NotificationCategory.SHIPPING,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'Out for delivery today 📦',
          body: `A parcel from order #${order.reference} is out for delivery.`,
          metadata: {
            order_id: order._id,
            order_reference: order.reference,
            tracking_number: trackingNumber,
          },
          action_url: '/orders',
        })
        .catch((err) =>
          this.logger.error('Failed to send out-for-delivery notification', err),
        );
    }

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
      audience: 'customer',
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

    await this.emailCustomerShippingUpdate(order, status, trackingNumber);
  }

  /**
   * Turn a ZeptoMail event into a status on the row we wrote when sending.
   *
   * The payload nests oddly: `event_name` is an array holding one name, and
   * `event_message` is an array of objects each wrapping an `email_info`.
   * Both are read defensively — this is someone else's shape, it arrives
   * unauthenticated bar a shared header, and a change at their end should
   * produce a log line rather than a stack trace.
   *
   * A feedback-loop event is a spam complaint. It is recorded as its own
   * status rather than folded into bounces because it means something
   * different: the address works, and the person did not want the mail.
   */
  async handleZeptomailWebhook(payload: any): Promise<{ received: true }> {
    const name = String(
      Array.isArray(payload?.event_name)
        ? payload.event_name[0]
        : payload?.event_name ?? '',
    ).toLowerCase();

    const STATUSES: Record<string, EmailStatus> = {
      delivered: EmailStatus.DELIVERED,
      softbounce: EmailStatus.SOFT_BOUNCE,
      soft_bounce: EmailStatus.SOFT_BOUNCE,
      hardbounce: EmailStatus.HARD_BOUNCE,
      hard_bounce: EmailStatus.HARD_BOUNCE,
      feedbackloop: EmailStatus.COMPLAINT,
      feedback_loop: EmailStatus.COMPLAINT,
    };

    const status = STATUSES[name];
    if (!status) {
      this.logger.warn(`ZeptoMail: ignoring unknown event "${name}"`);
      return { received: true };
    }

    const messages = Array.isArray(payload?.event_message)
      ? payload.event_message
      : [];

    for (const entry of messages) {
      const info = entry?.email_info ?? entry;
      if (!info) continue;

      // `to` is a list of { email_address: { address, name } }. A bounce also
      // carries bounce_address, which is the one that actually failed.
      const recipients: string[] = Array.isArray(info.to)
        ? info.to
            .map((t: any) => t?.email_address?.address)
            .filter((a: unknown): a is string => typeof a === 'string')
        : [];

      if (typeof info.bounce_address === 'string' && info.bounce_address) {
        recipients.push(info.bounce_address);
      }

      for (const to of [...new Set(recipients)]) {
        await this.mailService
          .applyDeliveryEvent({
            to,
            subject: typeof info.subject === 'string' ? info.subject : undefined,
            status,
            providerReference:
              typeof info.email_reference === 'string'
                ? info.email_reference
                : undefined,
            detail:
              typeof info.reason === 'string'
                ? info.reason
                : typeof info.details === 'string'
                  ? info.details
                  : undefined,
          })
          .catch((err: any) =>
            this.logger.warn(
              `ZeptoMail: could not apply "${name}" for ${to}: ${err?.message}`,
            ),
          );
      }
    }

    return { received: true };
  }

  /**
   * The shipped and delivered emails.
   *
   * Split out so a mail problem cannot take the in-app notification with it:
   * the bell above is already saved by the time this runs, and everything
   * here is best-effort. A courier webhook that fails because of an email
   * would be retried, and the customer would get the notification twice.
   *
   * Only two statuses send. A failed delivery is handled by a person, and an
   * automated "there was a problem" email with nothing actionable in it is
   * worse than the silence it replaces.
   */
  private async emailCustomerShippingUpdate(
    order: OrderDocument,
    status: ShipmentStatus,
    trackingNumber: string,
  ): Promise<void> {
    if (
      status !== ShipmentStatus.IN_TRANSIT &&
      status !== ShipmentStatus.DELIVERED
    ) {
      return;
    }

    try {
      // The order arrives with `customer` as an id. Read the address off a
      // fresh populate rather than threading it through every caller.
      const populated: any = await this.orderModel
        .findById(order._id)
        .select('customer reference total items createdAt')
        .populate('customer', 'full_name email')
        .lean();

      const to = populated?.customer?.email;
      if (!to) return;

      const name = populated.customer.full_name || 'there';

      if (status === ShipmentStatus.IN_TRANSIT) {
        await this.mailService.sendOrderShippedEmail(
          to,
          name,
          populated,
          trackingNumber,
        );
      } else {
        await this.mailService.sendOrderDeliveredEmail(to, name, populated);
      }
    } catch (error: any) {
      this.logger.warn(
        `Order ${order.reference}: ${status} email failed — ${error?.message}`,
      );
    }
  }
}
