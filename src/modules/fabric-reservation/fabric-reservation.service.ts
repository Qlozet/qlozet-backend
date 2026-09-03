import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';

import {
  FabricReservation,
  FabricReservationDocument,
  ReservationStatus,
} from './schemas/fabric-reservation.schema';
import {
  FabricClaim,
  FabricClaimDocument,
} from './schemas/fabric-claim.schema';
import { CreateReservationDto } from './dto/create-reservation.dto';
import {
  ClaimReservationDto,
  ClaimShippingPreviewDto,
} from './dto/claim-reservation.dto';
import { OrderService } from '../orders/orders.service';
import { StripeProvider } from '../payment-providers/stripe.provider';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';
import { TransactionService } from '../transactions/transactions.service';
import { PaymentService } from '../payment/payment.service';
import { PlatformService } from '../platform/platform.service';
import {
  Order,
  OrderDocument,
} from '../orders/schemas/orders.schema';
import { TransactionType } from '../transactions/schema/transaction.schema';
import { ProductDocument } from '../products/schemas';
import { Utils } from '../../common/utils/pagination';

@Injectable()
export class FabricReservationService {
  private readonly logger = new Logger(FabricReservationService.name);

  constructor(
    @InjectModel(FabricReservation.name)
    private readonly reservationModel: Model<FabricReservationDocument>,
    @InjectModel(FabricClaim.name)
    private readonly claimModel: Model<FabricClaimDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel('Product')
    private readonly productModel: Model<ProductDocument>,
    private readonly transactionService: TransactionService,
    private readonly paymentService: PaymentService,
    private readonly platformService: PlatformService,
    private readonly orderService: OrderService,
    private readonly stripeProvider: StripeProvider,
  ) {}

  // ════════════════════════════════════════════════════════════════
  //  ORGANIZER — Create Reservation
  // ════════════════════════════════════════════════════════════════

  async createReservation(dto: CreateReservationDto, organizer: any) {
    // 1. Validate fabric product
    const fabricProduct = await this.productModel.findById(dto.fabricId);
    if (!fabricProduct || fabricProduct.kind !== 'fabric') {
      throw new BadRequestException(
        'Invalid fabric: product not found or not a fabric type',
      );
    }

    const fabric = fabricProduct.fabric;
    if (!fabric) {
      throw new BadRequestException('Fabric data is missing from this product');
    }

    // 2. Check available inventory
    if (fabric.yard_length < dto.totalYards) {
      throw new BadRequestException(
        `Not enough fabric available. Requested: ${dto.totalYards} yards, Available: ${fabric.yard_length} yards`,
      );
    }

    // 3. Validate min_cut
    if (dto.totalYards < fabric.min_cut) {
      throw new BadRequestException(
        `Minimum reservation is ${fabric.min_cut} yards for this fabric`,
      );
    }

    // 4. Validate deadline is in the future
    const deadline = new Date(dto.deadline);
    if (deadline <= new Date()) {
      throw new BadRequestException('Deadline must be in the future');
    }

    // 5. Calculate reservation fee
    const settings = await this.platformService.getSettings();
    const feePercent = settings.reservation_fee_percent ?? 10;
    const totalFabricValue = dto.totalYards * fabric.price_per_yard;
    const reservationFee = Math.ceil((feePercent / 100) * totalFabricValue);

    // 6. Lock inventory — deduct from yard_length
    fabric.yard_length -= dto.totalYards;
    await fabricProduct.save();

    // 7–10 can each fail after the yards above were locked; roll the lock (and
    // any partial records) back so a failed create never strands inventory.
    let reservation: FabricReservationDocument | null = null;
    let order: OrderDocument | null = null;
    try {
      // 7. Create reservation record
      const reference = await generateUniqueQlozetReference(
        this.reservationModel,
        'RES',
      );

      reservation = await this.reservationModel.create({
        reference,
        organizer: new Types.ObjectId(organizer.id),
        fabric: fabricProduct._id,
        event_name: dto.eventName,
        total_yards: dto.totalYards,
        claimed_yards: 0,
        price_per_yard: fabric.price_per_yard,
        reservation_fee: reservationFee,
        deadline,
        status: ReservationStatus.ACTIVE,
      });

      // 8. Create the fee order + transaction. The order's item total_price is
      // 0 on purpose: the fee is PLATFORM revenue, not a vendor sale — earnings
      // must never be recorded against the fabric vendor for it.
      const orderReference = await generateUniqueQlozetReference(
        this.orderModel,
        'ORD',
      );

      order = await this.orderModel.create({
        reference: orderReference,
        customer: new Types.ObjectId(organizer.id),
        items: [
          {
            product: fabricProduct._id,
            business: fabricProduct.business,
            total_price: 0,
            fabric_selections: [
              {
                fabric_id: fabric._id,
                yardage: dto.totalYards,
                price: fabric.price_per_yard,
                quantity: 1,
                total_amount: totalFabricValue,
              },
            ],
            note: `Reservation fee for event: ${dto.eventName}`,
          },
        ],
        subtotal: reservationFee,
        shipping_fee: 0,
        total: reservationFee,
        status: 'pending',
        type: 'reservation',
      });

      // 9–10. Charge the fee — routed by currency exactly like checkout
      // (non-NGN → Stripe when available, else ₦/Paystack fallback).
      const { transaction, payment } =
        await this.orderService.initFlexibleCharge({
          customerId: organizer.id,
          email: organizer.email,
          orderId: order._id as Types.ObjectId,
          amountNaira: reservationFee,
          description: `Reservation fee for ${dto.eventName} (${reference})`,
          channel: 'reservation',
          metadata: {
            reservation_reference: reference,
            reservation_id: (reservation._id as Types.ObjectId).toString(),
            fabric_id: (fabricProduct._id as Types.ObjectId).toString(),
            total_yards: dto.totalYards,
            fee_percent: feePercent,
          },
          currency: dto.currency,
        });

      reservation.fee_transaction = transaction._id as Types.ObjectId;
      await reservation.save();

      this.logger.log(
        `Reservation created: ${reference} by organizer ${organizer.id} — ${dto.totalYards} yards locked`,
      );

      return {
        message: 'Reservation created. Please pay the reservation fee.',
        data: {
          reservation,
          transaction: {
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status,
          },
          payment,
        },
      };
    } catch (error) {
      // Roll back: release the locked yards and remove partial records.
      try {
        const freshProduct = await this.productModel.findById(dto.fabricId);
        if (freshProduct?.fabric) {
          freshProduct.fabric.yard_length += dto.totalYards;
          await freshProduct.save();
        }
        if (order) await this.orderModel.deleteOne({ _id: order._id });
        if (reservation)
          await this.reservationModel.deleteOne({ _id: reservation._id });
      } catch (rollbackError) {
        this.logger.error(
          `Reservation rollback failed: ${rollbackError.message}`,
        );
      }
      throw error;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  ORGANIZER — List My Reservations
  // ════════════════════════════════════════════════════════════════

  async getMyReservations(organizerId: string, page = 1, size = 10) {
    const filter = { organizer: new Types.ObjectId(organizerId) };
    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.reservationModel
        .find(filter)
        .populate('fabric', 'fabric base_price kind')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .exec(),
      this.reservationModel.countDocuments(filter),
    ]);

    // Self-heal any active-but-unflagged fees (missed webhook) so the
    // organizer's hub doesn't show "Awaiting Payment" on a fee that cleared.
    // Capped and PARALLEL — each check can cost a slow processor round-trip
    // (Stripe search), and running them sequentially made the hub take
    // seconds to open with a few unpaid rows.
    const unsettled = rows
      .filter((r) => r.status === ReservationStatus.ACTIVE && !r.fee_paid)
      .slice(0, 3);
    if (unsettled.length > 0) {
      await Promise.allSettled(
        unsettled.map((r) => this.ensureFeeSettled(r)),
      );
    }

    return Utils.getPagingData({ rows, count }, page, size);
  }

  // ════════════════════════════════════════════════════════════════
  //  Fee settlement self-heal
  //  fee_paid is normally flipped by the Paystack webhook (or the
  //  organizer's /payment/verify safety-net) — but webhooks can be missed
  //  (local dev, downtime) and the organizer may never return to the
  //  confirmation page. When a guest then opens the link or tries to
  //  claim, check the fee transaction ourselves and settle it in place.
  // ════════════════════════════════════════════════════════════════

  private async ensureFeeSettled(
    reservation: FabricReservationDocument,
    opts: { activeVerify?: boolean } = {},
  ): Promise<boolean> {
    const activeVerify = opts.activeVerify !== false;
    if (reservation.fee_paid) return true;
    if (!reservation.fee_transaction) return false;

    const txModel = (this.transactionService as any).transactionModel;
    let tx = await txModel.findById(reservation.fee_transaction);
    if (!tx) return false;

    // Actively confirm with the processor that charged when the stored status
    // isn't success — but give an in-progress checkout a 2-minute head start
    // so we don't race the organizer while they're still typing their card.
    // Stripe fees must NOT be verified via Paystack (that would wrongly mark
    // them failed). Callers on a latency-sensitive path (Pay Fee) pass
    // activeVerify:false to check the STORED status only — the processor
    // round-trip (Stripe search is slow) otherwise delays the retry by
    // seconds for a fee that is almost certainly just unpaid.
    const ageMs = Date.now() - new Date(tx.createdAt ?? 0).getTime();
    if (tx.status !== 'success' && activeVerify && ageMs > 2 * 60 * 1000) {
      const isStripe = (tx.metadata as any)?.payment_method === 'stripe';
      if (isStripe) {
        const check = await this.stripeProvider
          .verifyCharge(tx.reference)
          .catch(() => null);
        if (check?.paid) {
          await this.transactionService.markSuccess(tx.reference);
        }
      } else {
        await this.paymentService
          .verifyPaystackPayment(tx.reference)
          .catch(() => undefined);
      }
      tx = await txModel.findById(reservation.fee_transaction);
    }

    if (tx?.status !== 'success') {
      this.logger.warn(
        `Fee not settled for reservation ${reservation.reference}: transaction ${tx?.reference ?? '(missing)'} status=${tx?.status ?? 'unknown'}`,
      );
      return false;
    }

    reservation.fee_paid = true;
    await reservation.save();
    if (tx.order) {
      await this.orderModel.updateOne(
        { _id: tx.order._id ?? tx.order },
        { $set: { status: 'completed', payment_status: 'paid' } },
      );
    }
    this.logger.log(
      `Self-healed fee settlement for reservation ${reservation.reference}`,
    );
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC — Get Reservation Details (Guest Link)
  // ════════════════════════════════════════════════════════════════

  async getReservationDetails(reservationId: string) {
    // This is a PUBLIC guest link: name the organizer, never leak their email.
    // (User schema has full_name/username — the old firstName/lastName populate
    // matched nothing, so guest pages showed no organizer at all.)
    const reservation = await this.reservationModel
      .findById(reservationId)
      .populate('fabric', 'fabric base_price kind business')
      .populate('organizer', 'full_name username');

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    // Settle a paid-but-unflagged fee on the spot (missed webhook), so the
    // guest page never shows "awaiting activation" for a fee that cleared.
    if (
      !reservation.fee_paid &&
      reservation.status === ReservationStatus.ACTIVE
    ) {
      await this.ensureFeeSettled(reservation).catch(() => undefined);
    }

    const remainingYards = reservation.total_yards - reservation.claimed_yards;
    const progressPercent =
      reservation.total_yards > 0
        ? Math.round(
            (reservation.claimed_yards / reservation.total_yards) * 100,
          )
        : 0;

    // Paid claims only — an in-flight (unpaid) claim still holds yards, but the
    // guest count should reflect people who actually completed payment.
    const guestCount = await this.claimModel.countDocuments({
      reservation: reservation._id,
      paid: true,
    });

    // `message` matters: the response interceptor only un-nests { message, data }
    // envelopes. Without it the payload arrives double-nested and the shop's
    // guest page reads `undefined` — every valid link rendered "Not Found".
    return {
      message: 'Reservation details',
      data: {
        reservation,
        progress: {
          total_yards: reservation.total_yards,
          claimed_yards: reservation.claimed_yards,
          remaining_yards: remainingYards,
          progress_percent: progressPercent,
        },
        guest_count: guestCount,
        is_expired:
          reservation.deadline < new Date() ||
          reservation.status === ReservationStatus.EXPIRED,
        is_sold_out: remainingYards <= 0,
        // Fee not yet settled — claims are blocked until it is (or the
        // unpaid-holds cron cancels the reservation). Only meaningful when a
        // fee transaction actually exists; a reservation WITHOUT one (orphaned
        // by a failed create — the fee was never payable) is defunct and is
        // reported as cancelled so guests aren't told to "check back shortly"
        // for an activation that can never happen.
        is_pending_activation:
          reservation.status === ReservationStatus.ACTIVE &&
          !reservation.fee_paid &&
          !!reservation.fee_transaction,
        is_cancelled:
          reservation.status === ReservationStatus.CANCELLED ||
          (reservation.status === ReservationStatus.ACTIVE &&
            !reservation.fee_paid &&
            !reservation.fee_transaction),
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  GUEST — Delivery quote for a claim
  //  Most guests want their yards delivered rather than collected at the
  //  event. This quotes couriers for the single fabric parcel (vendor →
  //  guest address) via the standard checkout logistics pipeline; the
  //  returned request_token is what the claim call echoes back.
  // ════════════════════════════════════════════════════════════════

  async previewClaimShipping(
    reservationId: string,
    dto: ClaimShippingPreviewDto,
    guest: any,
  ) {
    const reservation = await this.reservationModel.findById(reservationId);
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException(
        `This reservation is ${reservation.status}.`,
      );
    }
    const fabricProduct = await this.productModel.findById(reservation.fabric);
    if (!fabricProduct) {
      throw new BadRequestException('Fabric no longer exists');
    }

    const quote = await this.orderService.quoteFabricClaimShipping(
      guest,
      fabricProduct,
      dto.yards,
      dto.address_id,
    );
    return { message: 'Delivery options', data: quote };
  }

  // ════════════════════════════════════════════════════════════════
  //  GUEST — Claim From Reservation
  // ════════════════════════════════════════════════════════════════

  async claimFromReservation(
    reservationId: string,
    dto: ClaimReservationDto,
    guest: any,
  ) {
    const reservation = await this.reservationModel.findById(reservationId);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    // Validate reservation is still active
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException(
        `This reservation is ${reservation.status}. Claims are no longer accepted.`,
      );
    }

    // The organizer must have paid the reservation fee before guests can buy
    // in — otherwise a guessed link could sell yards on a reservation that is
    // about to be auto-cancelled for non-payment. Self-heal first: if the fee
    // actually cleared but the webhook was missed, settle it now instead of
    // turning a paying guest away.
    if (!reservation.fee_paid) {
      const settled = await this.ensureFeeSettled(reservation).catch(
        () => false,
      );
      if (!settled) {
        throw new BadRequestException(
          'This reservation is awaiting activation by its organizer. Please try again shortly.',
        );
      }
    }

    // Validate deadline
    if (reservation.deadline < new Date()) {
      throw new BadRequestException(
        'This reservation has passed its deadline. Claims are no longer accepted.',
      );
    }

    // Validate availability
    const remainingYards = reservation.total_yards - reservation.claimed_yards;
    if (dto.yards > remainingYards) {
      throw new BadRequestException(
        `Not enough yards available. Requested: ${dto.yards}, Remaining: ${remainingYards}`,
      );
    }

    // Validate min_cut from the fabric product. Exception: when less than a
    // minimum cut is all that remains, taking EXACTLY the remainder is allowed
    // — otherwise the reservation's last few yards could never be claimed.
    const fabricProduct = await this.productModel.findById(reservation.fabric);
    if (
      fabricProduct?.fabric?.min_cut &&
      dto.yards < fabricProduct.fabric.min_cut &&
      dto.yards < remainingYards
    ) {
      throw new BadRequestException(
        `Minimum claim is ${fabricProduct.fabric.min_cut} yards for this fabric`,
      );
    }

    // Calculate total
    const totalAmount = dto.yards * reservation.price_per_yard;

    // ── Optional delivery: verify the quoted courier server-side and attach a
    // real shipment + address, so the vendor's normal confirm→fulfill→courier
    // pipeline applies. Without it the claim is an event-pickup handover.
    let claimShipment: any = null;
    let shippingFee = 0;
    let deliveryAddress: any = null;
    if (dto.courier) {
      const businessId = fabricProduct?.business?.toString();
      if (!businessId) {
        throw new BadRequestException(
          'This fabric has no vendor — delivery is unavailable',
        );
      }
      deliveryAddress = await this.orderService.getCustomerShippingAddress(
        guest.id,
        dto.address_id,
      );
      const built = await this.orderService.buildClaimShipment(
        guest.id,
        businessId,
        dto.courier,
      );
      claimShipment = built.shipment;
      shippingFee = built.fee;
    }
    const grandTotal = totalAmount + shippingFee;

    // Create an order for this claim
    const orderReference = await generateUniqueQlozetReference(
      this.orderModel,
      'ORD',
    );

    const order = await this.orderModel.create({
      reference: orderReference,
      customer: guest ? new Types.ObjectId(guest.id) : null,
      address: deliveryAddress ?? undefined,
      shipments: claimShipment ? [claimShipment] : [],
      items: [
        {
          product: reservation.fabric,
          business: fabricProduct?.business || null,
          // total_price drives recordBusinessEarnings — without it the fabric
          // vendor earned ₦0 from every claim.
          total_price: totalAmount,
          fabric_selections: [
            {
              fabric_id: fabricProduct?.fabric?._id || reservation.fabric,
              yardage: dto.yards,
              price: reservation.price_per_yard,
              quantity: 1,
              total_amount: totalAmount,
            },
          ],
          note: `Fabric claim from reservation: ${reservation.event_name}`,
        },
      ],
      subtotal: totalAmount,
      shipping_fee: shippingFee,
      total: grandTotal,
      status: 'pending',
      type: 'reservation_claim',
    });

    // Create audit claim record
    const claim = await this.claimModel.create({
      reservation: reservation._id,
      guest: guest ? new Types.ObjectId(guest.id) : null,
      order: order._id,
      yards_claimed: dto.yards,
      total_amount: totalAmount,
    });

    // Increment claimed yards
    reservation.claimed_yards += dto.yards;

    // Check if fully claimed
    if (reservation.claimed_yards >= reservation.total_yards) {
      reservation.status = ReservationStatus.COMPLETED;
    }

    await reservation.save();

    // Charge the guest — routed by currency like checkout (non-NGN → Stripe
    // when available, else ₦/Paystack). Amount includes delivery when chosen.
    const { transaction, payment } = await this.orderService.initFlexibleCharge(
      {
        customerId: guest.id,
        email: guest?.email || 'guest@qlozet.app',
        orderId: order._id as Types.ObjectId,
        amountNaira: grandTotal,
        description: `Fabric claim from reservation ${reservation.reference}`,
        channel: 'checkout',
        metadata: {
          reservation_reference: reservation.reference,
          reservation_id: (reservation._id as Types.ObjectId).toString(),
          claim_id: (claim._id as Types.ObjectId).toString(),
          yards_claimed: dto.yards,
        },
        currency: dto.currency,
      },
    );

    this.logger.log(
      `Claim created: ${dto.yards} yards from reservation ${reservation.reference}`,
    );

    return {
      message: 'Claim successful. Please complete payment.',
      data: {
        claim,
        order,
        transaction: {
          reference: transaction.reference,
          amount: transaction.amount,
          status: transaction.status,
        },
        payment,
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  ORGANIZER — Retry the fee payment
  //  Recovery path for a reservation stuck "awaiting activation": returns
  //  the fee's Paystack link again (the one stored at initialization, or a
  //  fresh initialization if none was stored) so the organizer can pay
  //  without cancelling and re-creating the whole reservation.
  // ════════════════════════════════════════════════════════════════

  async payReservationFee(
    reservationId: string,
    organizer: any,
    currency?: string,
  ) {
    const reservation = await this.reservationModel.findById(reservationId);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.organizer.toString() !== organizer.id) {
      throw new ForbiddenException(
        'You are not the organizer of this reservation',
      );
    }
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException(
        `This reservation is ${reservation.status} — the fee can no longer be paid.`,
      );
    }

    // Maybe it already settled (missed webhook) — then there's nothing to pay.
    // STORED status only: no processor round-trip here. The organizer clicked
    // "Pay Fee" because it reads unpaid; a slow Stripe-search verify would add
    // seconds before their payment page opens, and the view paths (guest link,
    // hub listing) already actively self-heal a settled-but-unflagged fee.
    if (
      await this.ensureFeeSettled(reservation, { activeVerify: false }).catch(
        () => false,
      )
    ) {
      return {
        message: 'Reservation fee is already paid.',
        data: { already_paid: true, reservation },
      };
    }

    if (!reservation.fee_transaction) {
      throw new BadRequestException(
        'This reservation has no payable fee — please cancel it and create a new one.',
      );
    }

    const txModel = (this.transactionService as any).transactionModel;
    const tx = await txModel.findById(reservation.fee_transaction);
    if (!tx) {
      throw new BadRequestException(
        'Fee transaction is missing — please cancel and create a new reservation.',
      );
    }

    // The retry charges in the caller's CURRENT display currency (an escape
    // hatch: if Stripe misbehaves for this user, switching the shop to ₦ and
    // retrying pays via Paystack instead), falling back to the original
    // charge currency when none is given.
    const retryCurrency =
      (currency ?? (tx.metadata as any)?.charge_currency ?? 'NGN').toUpperCase();

    // A still-PENDING Paystack charge can reuse its stored authorization URL
    // (Paystack rejects re-initializing an existing reference, and the hosted
    // page allows retrying until the transaction settles) — but only when the
    // retry is staying in ₦; a currency switch needs a fresh charge.
    const stored = (tx.metadata as any)?.paystack;
    const isStripe = (tx.metadata as any)?.payment_method === 'stripe';
    if (
      tx.status === 'pending' &&
      !isStripe &&
      retryCurrency === 'NGN' &&
      stored?.authorization_url
    ) {
      return {
        message: 'Complete your reservation fee payment.',
        data: {
          reservation,
          transaction: { reference: tx.reference, amount: tx.amount },
          payment: {
            paymentUrl: stored.authorization_url,
            reference: stored.reference ?? tx.reference,
            access_code: stored.access_code,
            amount: tx.amount,
          },
        },
      };
    }

    // FAILED/reversed references can't be recharged, and Stripe checkout
    // sessions expire — mint a FRESH fee charge (same ₦ amount and, for
    // international fees, the same charge currency) and point the
    // reservation at it. The old transaction stays as an audit record.
    const { transaction: freshTx, payment } =
      await this.orderService.initFlexibleCharge({
        customerId: organizer.id,
        email: organizer.email,
        orderId: (tx.order?._id ?? tx.order) as Types.ObjectId,
        amountNaira: tx.amount,
        description: `Reservation fee for ${reservation.event_name} (${reservation.reference})`,
        channel: 'reservation',
        metadata: {
          reservation_reference: reservation.reference,
          reservation_id: (reservation._id as Types.ObjectId).toString(),
          retry_of: tx.reference,
        },
        currency: retryCurrency,
      });
    reservation.fee_transaction = freshTx._id as Types.ObjectId;
    await reservation.save();

    return {
      message: 'Complete your reservation fee payment.',
      data: {
        reservation,
        transaction: { reference: freshTx.reference, amount: freshTx.amount },
        payment,
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  ORGANIZER — Cancel Reservation
  // ════════════════════════════════════════════════════════════════

  async cancelReservation(reservationId: string, organizerId: string) {
    const reservation = await this.reservationModel.findById(reservationId);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.organizer.toString() !== organizerId) {
      throw new ForbiddenException(
        'You are not the organizer of this reservation',
      );
    }

    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot cancel a reservation that is ${reservation.status}`,
      );
    }

    // Release unclaimed yards back to fabric inventory
    const unclaimed = reservation.total_yards - reservation.claimed_yards;
    if (unclaimed > 0) {
      const fabricProduct = await this.productModel.findById(reservation.fabric);
      if (fabricProduct?.fabric) {
        fabricProduct.fabric.yard_length += unclaimed;
        await fabricProduct.save();
        this.logger.log(
          `Released ${unclaimed} unclaimed yards back to fabric ${fabricProduct._id}`,
        );
      }
    }

    reservation.status = ReservationStatus.CANCELLED;
    await reservation.save();

    this.logger.log(
      `Reservation ${reservation.reference} cancelled. ${unclaimed} yards released.`,
    );

    return {
      message: `Reservation cancelled. ${unclaimed} unclaimed yards released back to inventory.`,
      data: reservation,
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  CRON — Auto-Release Expired Reservations (every hour)
  // ════════════════════════════════════════════════════════════════

  @Cron('0 * * * *')
  async releaseExpiredReservations() {
    const now = new Date();
    this.logger.log(
      `Running expired reservation check at ${now.toISOString()}`,
    );

    const expiredReservations = await this.reservationModel.find({
      deadline: { $lt: now },
      status: ReservationStatus.ACTIVE,
    });

    if (expiredReservations.length === 0) {
      this.logger.log('No expired reservations to process.');
      return;
    }

    for (const reservation of expiredReservations) {
      try {
        const unclaimed = reservation.total_yards - reservation.claimed_yards;

        // Release unclaimed yards
        if (unclaimed > 0) {
          const fabricProduct = await this.productModel.findById(
            reservation.fabric,
          );
          if (fabricProduct?.fabric) {
            fabricProduct.fabric.yard_length += unclaimed;
            await fabricProduct.save();
            this.logger.log(
              `Released ${unclaimed} yards from expired reservation ${reservation.reference}`,
            );
          }
        }

        reservation.status = ReservationStatus.EXPIRED;
        await reservation.save();

        this.logger.log(
          `Reservation ${reservation.reference} expired. ${unclaimed} yards released.`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process expired reservation ${reservation.reference}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Processed ${expiredReservations.length} expired reservation(s).`,
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  CRON — Release unpaid holds (every 15 minutes)
  //  Yards are held the moment a reservation/claim is created (so nobody can
  //  be over-sold during payment), but an abandoned payment must not lock
  //  inventory forever. Two sweeps:
  //   • claims unpaid after 45 min  → yards go back to the reservation
  //   • reservations whose FEE is unpaid after 2 h → cancelled, yards go back
  //     to the fabric (also cleans up rows orphaned by a failed create)
  // ════════════════════════════════════════════════════════════════

  @Cron('*/15 * * * *')
  async releaseUnpaidHolds() {
    const now = Date.now();

    // ── 1. Unpaid guest claims past the grace window ──
    const claimCutoff = new Date(now - 45 * 60 * 1000);
    const staleClaims = await this.claimModel.find({
      paid: false,
      released: false,
      createdAt: { $lt: claimCutoff },
    });

    for (const claim of staleClaims) {
      try {
        const reservation = await this.reservationModel.findById(
          claim.reservation,
        );
        if (reservation) {
          reservation.claimed_yards = Math.max(
            0,
            reservation.claimed_yards - claim.yards_claimed,
          );
          // A reservation that filled up on the strength of this claim reopens
          // — but only while its deadline is still in the future.
          if (
            reservation.status === ReservationStatus.COMPLETED &&
            reservation.deadline > new Date()
          ) {
            reservation.status = ReservationStatus.ACTIVE;
          }
          await reservation.save();
        }
        claim.released = true;
        await claim.save();
        if (claim.order) {
          await this.orderModel.updateOne(
            { _id: claim.order, payment_status: { $ne: 'paid' } },
            { $set: { status: 'cancelled' } },
          );
        }
        this.logger.log(
          `Released ${claim.yards_claimed} yards from unpaid claim ${claim._id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to release unpaid claim ${claim._id}: ${error.message}`,
        );
      }
    }

    // ── 2. Reservations whose fee was never paid ──
    // With a fee transaction: 2h to finish paying. Without one (orphaned by a
    // failed create — the fee was never even payable): 30 min, since no
    // payment can ever arrive for them.
    const feeCutoff = new Date(now - 2 * 60 * 60 * 1000);
    const orphanCutoff = new Date(now - 30 * 60 * 1000);
    const unpaidReservations = await this.reservationModel.find({
      status: ReservationStatus.ACTIVE,
      fee_paid: { $ne: true },
      $or: [
        { createdAt: { $lt: feeCutoff } },
        { fee_transaction: null, createdAt: { $lt: orphanCutoff } },
      ],
    });

    for (const reservation of unpaidReservations) {
      try {
        const unclaimed =
          reservation.total_yards - reservation.claimed_yards;
        if (unclaimed > 0) {
          const fabricProduct = await this.productModel.findById(
            reservation.fabric,
          );
          if (fabricProduct?.fabric) {
            fabricProduct.fabric.yard_length += unclaimed;
            await fabricProduct.save();
          }
        }
        reservation.status = ReservationStatus.CANCELLED;
        await reservation.save();
        this.logger.log(
          `Auto-cancelled unpaid reservation ${reservation.reference} — ${unclaimed} yards released`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to cancel unpaid reservation ${reservation.reference}: ${error.message}`,
        );
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  ORGANIZER — Get Reservation Claims
  // ════════════════════════════════════════════════════════════════

  async getReservationClaims(
    reservationId: string,
    organizerId: string,
    page = 1,
    size = 10,
  ) {
    const reservation = await this.reservationModel.findById(reservationId);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.organizer.toString() !== organizerId) {
      throw new ForbiddenException(
        'You are not the organizer of this reservation',
      );
    }

    const filter = { reservation: new Types.ObjectId(reservationId) };
    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.claimModel
        .find(filter)
        .populate('guest', 'firstName lastName email')
        .populate('order', 'reference status total')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .exec(),
      this.claimModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ rows, count }, page, size);
  }
}
