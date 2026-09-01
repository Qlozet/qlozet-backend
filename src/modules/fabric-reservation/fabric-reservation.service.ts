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
import { ClaimReservationDto } from './dto/claim-reservation.dto';
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

      const transaction = await this.transactionService.create({
        initiator: new Types.ObjectId(organizer.id),
        order: order._id as Types.ObjectId,
        type: TransactionType.DEBIT,
        amount: reservationFee,
        description: `Reservation fee for ${dto.eventName} (${reference})`,
        channel: 'reservation',
        metadata: {
          reservation_reference: reference,
          reservation_id: (reservation._id as Types.ObjectId).toString(),
          fabric_id: (fabricProduct._id as Types.ObjectId).toString(),
          total_yards: dto.totalYards,
          fee_percent: feePercent,
        },
      });

      // 9. Save transaction ref to reservation
      reservation.fee_transaction = transaction._id as Types.ObjectId;
      await reservation.save();

      // 10. Initialize Paystack payment for the fee
      const paymentInit = await this.paymentService.initializePaystackPayment(
        transaction.reference,
        organizer.email,
      );

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
          payment: paymentInit.data,
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

    return Utils.getPagingData({ rows, count }, page, size);
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
        is_cancelled: reservation.status === ReservationStatus.CANCELLED,
      },
    };
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
    // about to be auto-cancelled for non-payment.
    if (!reservation.fee_paid) {
      throw new BadRequestException(
        'This reservation is awaiting activation by its organizer. Please try again shortly.',
      );
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

    // Validate min_cut from the fabric product
    const fabricProduct = await this.productModel.findById(reservation.fabric);
    if (fabricProduct?.fabric?.min_cut && dto.yards < fabricProduct.fabric.min_cut) {
      throw new BadRequestException(
        `Minimum claim is ${fabricProduct.fabric.min_cut} yards for this fabric`,
      );
    }

    // Calculate total
    const totalAmount = dto.yards * reservation.price_per_yard;

    // Create an order for this claim
    const orderReference = await generateUniqueQlozetReference(
      this.orderModel,
      'ORD',
    );

    const order = await this.orderModel.create({
      reference: orderReference,
      customer: guest ? new Types.ObjectId(guest.id) : null,
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
      shipping_fee: 0,
      total: totalAmount,
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

    // Create transaction
    const transaction = await this.transactionService.create({
      initiator: guest ? new Types.ObjectId(guest.id) : undefined,
      order: order._id as Types.ObjectId,
      type: TransactionType.DEBIT,
      amount: totalAmount,
      description: `Fabric claim from reservation ${reservation.reference}`,
      channel: 'checkout',
      metadata: {
        reservation_reference: reservation.reference,
        reservation_id: (reservation._id as Types.ObjectId).toString(),
        claim_id: (claim._id as Types.ObjectId).toString(),
        yards_claimed: dto.yards,
      },
    });

    // Initialize Paystack payment
    const paymentInit = await this.paymentService.initializePaystackPayment(
      transaction.reference,
      guest?.email || 'guest@qlozet.app',
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
        payment: paymentInit.data,
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
    const feeCutoff = new Date(now - 2 * 60 * 60 * 1000);
    const unpaidReservations = await this.reservationModel.find({
      status: ReservationStatus.ACTIVE,
      fee_paid: { $ne: true },
      createdAt: { $lt: feeCutoff },
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
