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
import { MailService } from '../notifications/mail/mail.service';
import {
  Order,
  OrderDocument,
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
    private readonly transactionService: TransactionService,
    private readonly paymentService: PaymentService,
    private readonly mailService: MailService,
  ) {}

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
    }

    this.logger.log(
      `Quote requests sent for design ${design.reference} to ${newVendorIds.length} vendor(s)`,
    );

    return {
      message: `Quote requests sent to ${newVendorIds.length} vendor(s)`,
      data: quotes,
    };
  }

  async acceptQuote(quoteId: string, customer: any) {
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

    // Accept this quote, decline others
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

    // Update design
    design.status = BespokeDesignStatus.ACCEPTED;
    design.accepted_quote = quote._id as Types.ObjectId;
    await design.save();

    // Create order
    const orderReference = await generateUniqueQlozetReference(
      this.orderModel,
      'ORD',
    );

    const order = new this.orderModel({
      reference: orderReference,
      customer: new Types.ObjectId(customer.id),
      type: 'bespoke',
      bespoke_design: design._id,
      bespoke_quote: quote._id,
      items: [
        {
          product: design.fabric,
          business: quote.vendor,
          fabric_selections: design.fabric
            ? [
                {
                  fabric_id: design.fabric,
                  yardage: quote.required_fabric_yards || 0,
                  price: 0, // Will be updated from product
                  quantity: 1,
                  total_amount: 0,
                },
              ]
            : [],
          note: quote.vendor_notes,
        },
      ],
      subtotal: quote.total,
      shipping_fee: 0,
      total: quote.total,
      status: 'pending',
    });

    const savedOrder = await order.save();

    // Create transaction
    const transaction = await this.transactionService.create({
      initiator: new Types.ObjectId(customer.id),
      order: savedOrder._id as Types.ObjectId,
      type: TransactionType.DEBIT,
      amount: quote.total,
      description: `Bespoke order payment for design ${design.reference}`,
      channel: 'checkout',
      metadata: {
        order_reference: savedOrder.reference,
        bespoke_design_reference: design.reference,
        bespoke_quote_reference: quote.reference,
        items_count: 1,
      },
    });

    // Initialize payment
    const paymentInit = await this.paymentService.initializePaystackPayment(
      transaction.reference,
      customer.email,
    );

    this.logger.log(
      `Bespoke order ${orderReference} created from quote ${quote.reference}`,
    );

    return {
      message: 'Quote accepted. Redirect to payment.',
      data: {
        order: savedOrder,
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
