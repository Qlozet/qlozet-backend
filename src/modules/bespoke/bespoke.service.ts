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
  BespokeDesign,
  BespokeDesignDocument,
  BespokeDesignStatus,
} from './schemas/bespoke-design.schema';
import {
  BespokeQuote,
  BespokeQuoteDocument,
  BespokeQuoteStatus,
} from './schemas/bespoke-quote.schema';
import { CreateDesignDto } from './dto/create-design.dto';
import { RequestQuotesDto } from './dto/request-quotes.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { RevisionRequestDto } from './dto/revision-request.dto';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';
import { TransactionService } from '../transactions/transactions.service';
import { PaymentService } from '../payment/payment.service';
import { WalletsService } from '../wallets/wallets.service';
import { BusinessService } from '../business/business.service';
import {
  TransactionStatus,
} from '../transactions/schema/transaction.schema';
import { MailService } from '../notifications/mail/mail.service';
import {
  Order,
  OrderDocument,
  OrderStatus,
  ShipmentStatus,
  ShipmentType,
} from '../orders/schemas/orders.schema';
import {
  TransactionType,
} from '../transactions/schema/transaction.schema';
import {
  Business,
  BusinessDocument,
} from '../business/schemas/business.schema';
import { ProductDocument } from '../products/schemas';
import { User } from '../ums/schemas';
import { Utils } from '../../common/utils/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

const MAX_VENDORS_PER_DESIGN = 5;
const QUOTE_EXPIRY_DAYS = 7;

@Injectable()
export class BespokeService {
  private readonly logger = new Logger(BespokeService.name);

  constructor(
    @InjectModel(BespokeDesign.name)
    private readonly designModel: Model<BespokeDesignDocument>,
    @InjectModel(BespokeQuote.name)
    private readonly quoteModel: Model<BespokeQuoteDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel('Product')
    private readonly productModel: Model<ProductDocument>,
    @InjectModel('Address')
    private readonly addressModel: Model<any>,
    @InjectModel('BusinessEarning')
    private readonly businessEarningsModel: Model<any>,
    @InjectModel('PlatformSettings')
    private readonly platformSettingsModel: Model<any>,
    private readonly transactionService: TransactionService,
    private readonly paymentService: PaymentService,
    private readonly walletsService: WalletsService,
    private readonly businessService: BusinessService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Finalise a paid bespoke order: accept the winning quote, decline the
   * siblings, mark the design in-production, move the order to `processing`,
   * record the vendor's (split) earnings and schedule the upfront milestone.
   * Idempotent. Used by the wallet path (instant) — the Paystack path finalises
   * from the webhook.
   */
  private async finalizeBespokeOrder(
    order: OrderDocument,
    quote: BespokeQuoteDocument,
    design: BespokeDesignDocument,
  ) {
    quote.status = BespokeQuoteStatus.ACCEPTED;
    quote.accepted_at = new Date();
    await quote.save();

    await this.quoteModel.updateMany(
      {
        design: design._id,
        _id: { $ne: quote._id },
        status: {
          $in: [
            BespokeQuoteStatus.PENDING,
            BespokeQuoteStatus.DRAFT,
            BespokeQuoteStatus.SUBMITTED,
            BespokeQuoteStatus.REVISION_REQUESTED,
          ],
        },
      },
      { $set: { status: BespokeQuoteStatus.DECLINED } },
    );

    design.status = BespokeDesignStatus.IN_PRODUCTION;
    design.accepted_quote = quote._id as Types.ObjectId;
    await design.save();

    order.status = OrderStatus.PROCESSING;
    await order.save();

    await this.businessService.recordBusinessEarnings(
      order._id as Types.ObjectId,
    );

    // Release the tailor's UPFRONT milestone (funds materials).
    const settings = await this.platformSettingsModel.findOne().lean();
    const payoutDelayDays = (settings as any)?.payout_delay_days ?? 3;
    const releaseDate = new Date(
      Date.now() + payoutDelayDays * 24 * 60 * 60 * 1000,
    );
    await this.businessEarningsModel.updateMany(
      {
        order: order._id,
        milestone: 'upfront',
        released: false,
        release_date: null,
      },
      { $set: { release_date: releaseDate } },
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  CUSTOMER — Design CRUD
  // ════════════════════════════════════════════════════════════════

  async createDesign(dto: CreateDesignDto, customer: any) {
    // Validate fabric if provided
    if (dto.fabric_id) {
      const fabric = await this.productModel.findById(dto.fabric_id);
      if (!fabric || fabric.kind !== 'fabric') {
        throw new BadRequestException(
          'Invalid fabric: product not found or not a fabric type',
        );
      }
    }

    const reference = await generateUniqueQlozetReference(
      this.designModel,
      'BES',
    );

    const design = await this.designModel.create({
      reference,
      customer: new Types.ObjectId(customer.id),
      name: dto.name,
      category: dto.category,
      gender: dto.gender,
      design_images: dto.design_images,
      reference_images: dto.reference_images || [],
      fabric: dto.fabric_id ? new Types.ObjectId(dto.fabric_id) : null,
      description: dto.description || null,
      measurement: dto.measurement_id
        ? new Types.ObjectId(dto.measurement_id)
        : null,
      status: BespokeDesignStatus.DRAFT,
    });

    this.logger.log(
      `Design created: ${reference} by customer ${customer.id}`,
    );

    return { message: 'Design saved successfully', data: design };
  }

  async updateDesign(designId: string, dto: CreateDesignDto, customer: any) {
    const design = await this.designModel.findOne({
      _id: new Types.ObjectId(designId),
      customer: new Types.ObjectId(customer.id),
    });

    if (!design) throw new NotFoundException('Design not found');

    if (
      design.status !== BespokeDesignStatus.DRAFT &&
      design.status !== BespokeDesignStatus.REQUESTING_QUOTES
    ) {
      throw new BadRequestException(
        'Cannot update a design already in production',
      );
    }

    // Validate fabric if provided
    if (dto.fabric_id) {
      const fabric = await this.productModel.findById(dto.fabric_id);
      if (!fabric || fabric.kind !== 'fabric') {
        throw new BadRequestException(
          'Invalid fabric: product not found or not a fabric type',
        );
      }
    }

    design.name = dto.name;
    design.category = dto.category;
    design.gender = dto.gender;
    design.design_images = dto.design_images;
    design.reference_images = dto.reference_images || [];
    design.description = dto.description || (null as any);
    if (dto.fabric_id) design.fabric = new Types.ObjectId(dto.fabric_id);
    if (dto.measurement_id)
      design.measurement = new Types.ObjectId(dto.measurement_id);

    await design.save();

    this.logger.log(
      `Design updated: ${design.reference} by customer ${customer.id}`,
    );

    return { message: 'Design updated successfully', data: design };
  }

  async getMyDesigns(
    customerId: string,
    page = 1,
    size = 10,
    status?: string,
  ) {
    const filter: any = { customer: new Types.ObjectId(customerId) };
    if (status) filter.status = status;

    const [designs, total] = await Promise.all([
      this.designModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .populate('fabric', 'name fabric')
        .lean(),
      this.designModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: total, rows: designs },
      page,
      size,
    );
  }

  async getDesignWithQuotes(designId: string, customerId: string) {
    const design = await this.designModel
      .findOne({
        _id: new Types.ObjectId(designId),
        customer: new Types.ObjectId(customerId),
      })
      .populate('fabric')
      .populate('accepted_quote')
      .lean();

    if (!design) throw new NotFoundException('Design not found');

    const quotes = await this.quoteModel
      .find({ design: design._id })
      .populate('vendor', 'business_name business_logo_url business_email')
      .sort({ createdAt: -1 })
      .lean();

    return { data: { design, quotes } };
  }

  async cancelDesign(designId: string, customerId: string) {
    const design = await this.designModel.findOne({
      _id: new Types.ObjectId(designId),
      customer: new Types.ObjectId(customerId),
    });

    if (!design) throw new NotFoundException('Design not found');

    if (
      design.status === BespokeDesignStatus.IN_PRODUCTION ||
      design.status === BespokeDesignStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Cannot cancel a design that is already in production or completed',
      );
    }

    // Cancel all pending/draft quotes
    await this.quoteModel.updateMany(
      {
        design: design._id,
        status: {
          $in: [
            BespokeQuoteStatus.PENDING,
            BespokeQuoteStatus.DRAFT,
            BespokeQuoteStatus.SUBMITTED,
            BespokeQuoteStatus.REVISION_REQUESTED,
          ],
        },
      },
      { $set: { status: BespokeQuoteStatus.DECLINED } },
    );

    design.status = BespokeDesignStatus.CANCELLED;
    await design.save();

    return { message: 'Design cancelled successfully' };
  }

  // ════════════════════════════════════════════════════════════════
  //  CUSTOMER — Quote Actions
  // ════════════════════════════════════════════════════════════════

  async requestQuotes(
    designId: string,
    dto: RequestQuotesDto,
    customer: any,
  ) {
    const design = await this.designModel.findOne({
      _id: new Types.ObjectId(designId),
      customer: new Types.ObjectId(customer.id),
    });

    if (!design) throw new NotFoundException('Design not found');

    if (
      design.status !== BespokeDesignStatus.DRAFT &&
      design.status !== BespokeDesignStatus.REQUESTING_QUOTES &&
      design.status !== BespokeDesignStatus.QUOTED
    ) {
      throw new BadRequestException(
        `Cannot request quotes when design status is "${design.status}"`,
      );
    }

    // Enforce max vendor limit
    const existingQuoteCount = await this.quoteModel.countDocuments({
      design: design._id,
    });
    const totalAfterRequest = existingQuoteCount + dto.vendor_ids.length;

    if (totalAfterRequest > MAX_VENDORS_PER_DESIGN) {
      throw new BadRequestException(
        `Maximum ${MAX_VENDORS_PER_DESIGN} vendors per design. You already have ${existingQuoteCount} quote(s).`,
      );
    }

    // Validate vendor IDs and check for duplicates
    const existingVendorIds = (
      await this.quoteModel.find({ design: design._id }).select('vendor')
    ).map((q) => q.vendor.toString());

    const newVendorIds = dto.vendor_ids.filter(
      (id) => !existingVendorIds.includes(id),
    );

    if (newVendorIds.length === 0) {
      throw new BadRequestException(
        'All selected vendors already have quote requests for this design',
      );
    }

    // Validate businesses exist
    const businesses = await this.businessModel.find({
      _id: { $in: newVendorIds.map((id) => new Types.ObjectId(id)) },
    });

    if (businesses.length !== newVendorIds.length) {
      throw new BadRequestException('One or more vendor IDs are invalid');
    }

    // Create quotes
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + QUOTE_EXPIRY_DAYS);

    const quotes = await Promise.all(
      newVendorIds.map(async (vendorId) => {
        const reference = await generateUniqueQlozetReference(
          this.quoteModel,
          'BQT',
        );
        return this.quoteModel.create({
          reference,
          design: design._id,
          vendor: new Types.ObjectId(vendorId),
          customer: new Types.ObjectId(customer.id),
          status: BespokeQuoteStatus.PENDING,
          expires_at: expiresAt,
        });
      }),
    );

    // Update design status
    if (design.status === BespokeDesignStatus.DRAFT) {
      design.status = BespokeDesignStatus.REQUESTING_QUOTES;
      await design.save();
    }

    // Send email notifications to vendors (non-blocking)
    for (const business of businesses) {
      try {
        await this.mailService.sendQuoteRequestEmail(
          business.business_email,
          business.business_name,
          design.name,
          design.design_images,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send quote request email to ${business.business_email}: ${err.message}`,
        );
      }

      // In-app notification
      this.notificationsService.create({
        recipient: (business as any)._id?.toString(),
        recipient_business: (business as any)._id?.toString(),
        category: NotificationCategory.BESPOKE,
        type: NotificationType.BESPOKE_QUOTE_REQUEST,
        title: 'New Bespoke Quote Request',
        body: `A customer wants a quote for "${design.name}". You have 7 days to respond.`,
        metadata: { design_id: design._id, design_name: design.name },
        action_url: `/bespoke/quotes`,
      }).catch((err) => this.logger.warn(`Failed to create in-app notification: ${err.message}`));
    }

    this.logger.log(
      `Quote requests sent for design ${design.reference} to ${newVendorIds.length} vendor(s)`,
    );

    return {
      message: `Quote requests sent to ${newVendorIds.length} vendor(s)`,
      data: quotes,
    };
  }

  async acceptQuote(
    quoteId: string,
    customer: any,
    paymentMethod: 'wallet' | 'paystack' = 'paystack',
    addressId?: string,
  ) {
    const quote = await this.quoteModel.findOne({
      _id: new Types.ObjectId(quoteId),
      customer: new Types.ObjectId(customer.id),
    });

    if (!quote) throw new NotFoundException('Quote not found');

    if (quote.status !== BespokeQuoteStatus.SUBMITTED) {
      throw new BadRequestException(
        `Cannot accept a quote with status "${quote.status}". Only submitted quotes can be accepted.`,
      );
    }

    // Check expiry
    if (new Date() > quote.expires_at) {
      quote.status = BespokeQuoteStatus.EXPIRED;
      await quote.save();
      throw new BadRequestException('This quote has expired');
    }

    const design = await this.designModel.findById(quote.design);
    if (!design) throw new NotFoundException('Design not found');

    // Find an existing unpaid order for this quote (retry) or create a new one.
    // IMPORTANT: acceptance (accept quote + decline the alternatives) is
    // finalised only once payment SUCCEEDS — inline for wallet (instant), or via
    // the Paystack webhook — so an abandoned card payment never leaves the
    // customer stuck with every other quote already declined.
    let order = await this.orderModel.findOne({
      bespoke_quote: quote._id,
      status: OrderStatus.PENDING,
    });

    if (!order) {
      // Resolve the customer's shipping address (so the tailor can fulfil).
      // Prefer the address the shop explicitly selected (looked up by _id,
      // scoped to the customer), then their default, then any saved address.
      const customerObjectId = new Types.ObjectId(customer.id);
      const address =
        (addressId
          ? await this.addressModel.findOne({
              _id: new Types.ObjectId(addressId),
              customer: customerObjectId,
            })
          : null) ||
        (await this.addressModel.findOne({
          customer: customerObjectId,
          is_default: true,
        })) ||
        (await this.addressModel.findOne({ customer: customerObjectId }));
      if (!address) {
        // Decisive diagnostics: distinguish an account/id mismatch from bespoke
        // querying the wrong collection/connection.
        const forCustomer = await this.addressModel.countDocuments({
          customer: customerObjectId,
        });
        const inCollection = await this.addressModel.estimatedDocumentCount();
        let sentAddrOwner = 'n/a';
        if (addressId) {
          try {
            const raw = await this.addressModel
              .findById(new Types.ObjectId(addressId))
              .lean();
            sentAddrOwner = raw
              ? `owner=${String((raw as any).customer)}`
              : 'not-found';
          } catch {
            sentAddrOwner = 'invalid-id';
          }
        }
        this.logger.warn(
          `[acceptQuote] No shipping address for customer ${customer.id} ` +
            `(addressId=${addressId ?? 'none'}, forCustomer=${forCustomer}, ` +
            `inCollection=${inCollection}, sentAddr=${sentAddrOwner}).`,
        );
        throw new BadRequestException(
          'Please add a shipping address before accepting a quote.',
        );
      }

      // Single vendor = the tailor (their quote total is the full price; line
      // items itemise fabric/accessories/labour). The tailor already committed
      // by quoting, so the shipment is pre-confirmed. Deadline = estimated days.
      const orderReference = await generateUniqueQlozetReference(
        this.orderModel,
        'ORD',
      );
      const deadline = new Date();
      deadline.setDate(
        deadline.getDate() + (quote.estimated_completion_days || 7),
      );

      order = await new this.orderModel({
        reference: orderReference,
        customer: new Types.ObjectId(customer.id),
        type: 'bespoke',
        bespoke_design: design._id,
        bespoke_quote: quote._id,
        address: (address as any).toObject
          ? (address as any).toObject()
          : address,
        items: [
          {
            product: design.fabric || null,
            business: quote.vendor,
            total_price: quote.total,
            note: quote.vendor_notes,
          },
        ],
        shipments: [
          {
            business: quote.vendor,
            shipment_type: ShipmentType.VENDOR_TO_CUSTOMER,
            status: ShipmentStatus.PENDING,
            confirmed: true,
            confirmed_at: new Date(),
            fulfillment_deadline: deadline,
            shipping_fee: 0,
          },
        ],
        subtotal: quote.total,
        shipping_fee: 0,
        total: quote.total,
        status: OrderStatus.PENDING,
      }).save();
    }

    // ── WALLET PAYMENT (instant → finalise inline) ──
    if (paymentMethod === 'wallet') {
      const wallet = await this.walletsService.getOrCreateWallet({
        customer: customer.id,
      });
      if (wallet.balance < order.total) {
        throw new BadRequestException(
          `Insufficient wallet balance. You have ₦${wallet.balance.toLocaleString()} but the order total is ₦${order.total.toLocaleString()}.`,
        );
      }
      await this.walletsService.debitWallet(
        wallet._id.toString(),
        order.total,
      );
      try {
        const tx = await this.transactionService.create({
          initiator: new Types.ObjectId(customer.id),
          order: order._id as Types.ObjectId,
          wallet: wallet._id,
          type: TransactionType.DEBIT,
          amount: order.total,
          status: TransactionStatus.SUCCESS,
          description: `Wallet payment for bespoke order ${order.reference}`,
          channel: 'wallet_checkout',
          metadata: {
            order_reference: order.reference,
            bespoke_quote_reference: quote.reference,
            payment_method: 'wallet',
          },
        });
        await this.finalizeBespokeOrder(order, quote, design);
        this.logger.log(
          `Bespoke order ${order.reference} paid from wallet + confirmed`,
        );
        return {
          message: 'Payment successful. Your bespoke order is confirmed.',
          data: {
            order,
            transaction: {
              reference: tx.reference,
              amount: tx.amount,
              status: tx.status,
            },
            payment: null,
          },
        };
      } catch (err: any) {
        // Refund the wallet if anything after the debit failed.
        await this.walletsService
          .creditWallet(wallet._id.toString(), order.total)
          .catch((e) =>
            this.logger.error(
              `Wallet refund after failed bespoke pay: ${e?.message}`,
            ),
          );
        throw err;
      }
    }

    // ── PAYSTACK PAYMENT (finalised by the webhook on success) ──
    const transaction = await this.transactionService.create({
      initiator: new Types.ObjectId(customer.id),
      order: order._id as Types.ObjectId,
      type: TransactionType.DEBIT,
      amount: order.total,
      description: `Bespoke order payment for design ${design.reference}`,
      channel: 'checkout',
      metadata: {
        order_reference: order.reference,
        bespoke_design_reference: design.reference,
        bespoke_quote_reference: quote.reference,
        items_count: 1,
      },
    });
    const paymentInit = await this.paymentService.initializePaystackPayment(
      transaction.reference,
      customer.email,
    );

    return {
      message: 'Quote accepted. Redirect to payment.',
      data: {
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

  async requestRevision(
    quoteId: string,
    customerId: string,
    dto: RevisionRequestDto,
  ) {
    const quote = await this.quoteModel
      .findOne({
        _id: new Types.ObjectId(quoteId),
        customer: new Types.ObjectId(customerId),
      })
      .populate('vendor', 'business_email business_name')
      .populate('design', 'name');

    if (!quote) throw new NotFoundException('Quote not found');

    if (
      quote.status !== BespokeQuoteStatus.SUBMITTED &&
      quote.status !== BespokeQuoteStatus.DRAFT
    ) {
      throw new BadRequestException(
        'Can only request revision on submitted or draft quotes',
      );
    }

    quote.status = BespokeQuoteStatus.REVISION_REQUESTED;
    quote.revision_history.push({
      requested_by: 'customer',
      message: dto.message,
      created_at: new Date(),
    });
    await quote.save();

    // Send email notification to vendor
    try {
      const vendor = quote.vendor as any;
      const design = quote.design as any;
      await this.mailService.sendQuoteRevisionEmail(
        vendor.business_email,
        vendor.business_name,
        design.name,
        dto.message,
      );
    } catch (err) {
      this.logger.warn(`Failed to send revision email: ${err.message}`);
    }

    // In-app notification to vendor
    const vendorBiz = quote.vendor as any;
    const revDesign = quote.design as any;
    this.notificationsService.create({
      recipient: vendorBiz._id?.toString(),
      recipient_business: vendorBiz._id?.toString(),
      category: NotificationCategory.BESPOKE,
      type: NotificationType.BESPOKE_QUOTE_REVISION,
      title: 'Quote Revision Requested',
      body: `A customer requested a revision on your quote for "${revDesign?.name || 'a design'}".`,
      metadata: { quote_id: quote._id, design_name: revDesign?.name },
      action_url: `/bespoke/quotes`,
    }).catch((err) => this.logger.warn(`Failed to create revision notification: ${err.message}`));

    return { message: 'Revision requested', data: quote };
  }

  // ════════════════════════════════════════════════════════════════
  //  VENDOR — Quote Management
  // ════════════════════════════════════════════════════════════════

  async getQuoteRequests(
    businessId: string,
    page = 1,
    size = 10,
    status?: string,
  ) {
    const filter: any = {
      vendor: new Types.ObjectId(businessId),
      status: { $ne: BespokeQuoteStatus.EXPIRED },
    };
    if (status) filter.status = status;

    const [quotes, total] = await Promise.all([
      this.quoteModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .populate('design', 'name category gender design_images reference_images description fabric')
        .populate('customer', 'first_name last_name email')
        .lean(),
      this.quoteModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: total, rows: quotes },
      page,
      size,
    );
  }

  async getQuoteDetail(quoteId: string, businessId: string) {
    const quote = await this.quoteModel
      .findOne({
        _id: new Types.ObjectId(quoteId),
        vendor: new Types.ObjectId(businessId),
      })
      .populate({
        path: 'design',
        populate: { path: 'fabric' },
      })
      .populate('customer', 'first_name last_name email')
      .lean();

    if (!quote) throw new NotFoundException('Quote not found');

    return { data: quote };
  }

  async getQuoteDetailForCustomer(quoteId: string, customerId: string) {
    const quote = await this.quoteModel
      .findOne({
        _id: new Types.ObjectId(quoteId),
        customer: new Types.ObjectId(customerId),
      })
      .populate({
        path: 'design',
        populate: { path: 'fabric' },
      })
      .populate('vendor', 'business_name business_logo_url business_email')
      .lean();

    if (!quote) throw new NotFoundException('Quote not found');

    return { data: quote };
  }

  async saveQuoteDraft(
    quoteId: string,
    businessId: string,
    dto: SaveDraftDto,
  ) {
    const quote = await this.quoteModel.findOne({
      _id: new Types.ObjectId(quoteId),
      vendor: new Types.ObjectId(businessId),
    });

    if (!quote) throw new NotFoundException('Quote not found');

    if (
      quote.status !== BespokeQuoteStatus.PENDING &&
      quote.status !== BespokeQuoteStatus.DRAFT &&
      quote.status !== BespokeQuoteStatus.REVISION_REQUESTED
    ) {
      throw new BadRequestException(
        `Cannot edit a quote with status "${quote.status}"`,
      );
    }

    // Update fields
    if (dto.line_items !== undefined) quote.line_items = dto.line_items as any;
    if (dto.required_fabric_yards !== undefined)
      quote.required_fabric_yards = dto.required_fabric_yards;
    if (dto.estimated_completion_days !== undefined)
      quote.estimated_completion_days = dto.estimated_completion_days;
    if (dto.vendor_notes !== undefined)
      quote.vendor_notes = dto.vendor_notes;

    // Calculate total from line items
    if (dto.line_items) {
      quote.total = dto.line_items.reduce(
        (sum, item) => sum + (item.amount || 0),
        0,
      );
    }

    quote.status = BespokeQuoteStatus.DRAFT;
    await quote.save();

    return { message: 'Draft saved', data: quote };
  }

  async submitQuote(
    quoteId: string,
    businessId: string,
    dto: SubmitQuoteDto,
  ) {
    const quote = await this.quoteModel
      .findOne({
        _id: new Types.ObjectId(quoteId),
        vendor: new Types.ObjectId(businessId),
      })
      .populate('customer', 'first_name last_name email')
      .populate('design', 'name');

    if (!quote) throw new NotFoundException('Quote not found');

    if (
      quote.status !== BespokeQuoteStatus.PENDING &&
      quote.status !== BespokeQuoteStatus.DRAFT &&
      quote.status !== BespokeQuoteStatus.REVISION_REQUESTED
    ) {
      throw new BadRequestException(
        `Cannot submit a quote with status "${quote.status}"`,
      );
    }

    // Check expiry
    if (new Date() > quote.expires_at) {
      quote.status = BespokeQuoteStatus.EXPIRED;
      await quote.save();
      throw new BadRequestException('This quote has expired');
    }

    // Update quote
    quote.line_items = dto.line_items as any;
    quote.total = dto.line_items.reduce((sum, item) => sum + item.amount, 0);
    quote.required_fabric_yards = dto.required_fabric_yards;
    quote.estimated_completion_days = dto.estimated_completion_days;
    quote.vendor_notes = dto.vendor_notes || '';
    const previousStatus = quote.status;
    quote.status = BespokeQuoteStatus.SUBMITTED;
    quote.submitted_at = new Date();

    // If this was a revision, add to history
    if (previousStatus === BespokeQuoteStatus.REVISION_REQUESTED) {
      quote.revision_history.push({
        requested_by: 'vendor',
        message: 'Quote updated and resubmitted',
        created_at: new Date(),
      });
    }

    await quote.save();

    // Update design status
    await this.designModel.updateOne(
      { _id: quote.design },
      { $set: { status: BespokeDesignStatus.QUOTED } },
    );

    // Get vendor info for the email
    const business = await this.businessModel.findById(businessId);

    // Send email notification to customer
    try {
      const customerUser = quote.customer as any;
      await this.mailService.sendQuoteSubmittedEmail(
        customerUser.email,
        customerUser.first_name,
        business?.business_name || 'A vendor',
        quote.total,
        dto.estimated_completion_days,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send quote submitted email: ${err.message}`,
      );
    }

    // In-app notification to customer
    const quoteCustomer = quote.customer as any;
    this.notificationsService.create({
      recipient: quoteCustomer._id?.toString() || quoteCustomer.id?.toString(),
      category: NotificationCategory.BESPOKE,
      type: NotificationType.BESPOKE_QUOTE_RECEIVED,
      title: 'Quote Received!',
      body: `${business?.business_name || 'A vendor'} submitted a quote of ₦${quote.total?.toLocaleString()} for your bespoke design.`,
      metadata: { quote_id: quote._id, vendor_name: business?.business_name, total: quote.total },
      action_url: `/bespoke`,
    }).catch((err) => this.logger.warn(`Failed to create quote notification: ${err.message}`));

    this.logger.log(
      `Quote ${quote.reference} submitted by vendor ${businessId}`,
    );

    return { message: 'Quote submitted successfully', data: quote };
  }

  // ════════════════════════════════════════════════════════════════
  //  CRON — Auto-expire quotes
  // ════════════════════════════════════════════════════════════════

  @Cron('0 0 * * *', { timeZone: 'Africa/Lagos' })
  async expireQuotes() {
    const result = await this.quoteModel.updateMany(
      {
        expires_at: { $lt: new Date() },
        status: {
          $in: [
            BespokeQuoteStatus.PENDING,
            BespokeQuoteStatus.DRAFT,
            BespokeQuoteStatus.REVISION_REQUESTED,
          ],
        },
      },
      { $set: { status: BespokeQuoteStatus.EXPIRED } },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `🕐 Auto-expired ${result.modifiedCount} bespoke quote(s)`,
      );
    }
  }
}
