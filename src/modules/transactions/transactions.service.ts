import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TransactionStatus,
  TransactionType,
} from './schema/transaction.schema';
import { Utils } from '../../common/utils/pagination';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { BusinessService } from '../business/business.service';

interface CreateTransactionDto {
  initiator?: Types.ObjectId;
  amount: number;
  type: TransactionType;
  status?: TransactionStatus;
  wallet?: Types.ObjectId;
  order?: Types.ObjectId;
  channel: string;
  description?: string;
  currency?: string;
  payment_method?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class TransactionService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly httpService: HttpService,
    private readonly businessService: BusinessService,
    private readonly configService: ConfigService,
  ) {}

  // ✅ Create a new transaction
  async create(dto: CreateTransactionDto): Promise<TransactionDocument> {
    const reference = await generateUniqueQlozetReference(
      this.transactionModel,
      'TRX',
    );
    const transaction = new this.transactionModel({
      initiator: dto.initiator,
      wallet: dto.wallet ? dto.wallet : undefined,
      order: dto.order ? dto.order : undefined,
      type: dto.type,
      amount: dto.amount,
      reference,
      description: dto.description ?? '',
      currency: dto.currency ?? 'NGN',
      payment_method: dto.payment_method ?? 'paystack',
      metadata: dto.metadata ?? {},
      status: dto.status ?? TransactionStatus.PENDING,
    });

    return transaction.save();
  }

  // ✅ Initialize Paystack Payment

  // ✅ Update transaction status
  async updateStatus(
    reference: string,
    status: TransactionStatus,
  ): Promise<TransactionDocument> {
    const tx = await this.transactionModel.findOne({ reference });
    if (!tx) throw new NotFoundException('Transaction not found');

    tx.status = status;
    await tx.save();
    return tx;
  }

  async markSuccess(reference: string) {
    return this.updateStatus(reference, TransactionStatus.SUCCESS);
  }

  async markFailed(reference: string) {
    return this.updateStatus(reference, TransactionStatus.FAILED);
  }

  async findByBusiness(
    business: Types.ObjectId,
    page = 1,
    size = 10,
    status?: string,
  ) {
    const { take, skip } = await Utils.getPagination(page, size);

    const businessId =
      typeof business === 'string' ? new Types.ObjectId(business) : business;

    const matchStage: any = {};
    if (status && status !== 'all') {
      matchStage.status = status.toLowerCase();
    }

    const basePipeline: any[] = [
      { $match: matchStage },

      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'order',
        },
      },
      { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: 'wallets',
          localField: 'wallet',
          foreignField: '_id',
          as: 'walletDoc',
        },
      },
      { $unwind: { path: '$walletDoc', preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          orderItemsForBusiness: {
            $filter: {
              input: { $ifNull: ['$order.items', []] },
              as: 'item',
              cond: { $eq: ['$$item.business', businessId] },
            },
          },
          isWalletRelated: {
            $eq: ['$walletDoc.business', businessId]
          },
          isInitiatorRelated: {
            $eq: ['$initiator', businessId]
          }
        },
      },
      
      {
        $match: {
          $or: [
            { 'orderItemsForBusiness.0': { $exists: true } },
            { isWalletRelated: true },
            { isInitiatorRelated: true }
          ]
        }
      },

      // project only minimal order object
      {
        $project: {
          __v: 0,
          metadata: 0,
          'order.items': 0, // remove full items
          'order.address': 0,
          'order.subtotal': 0,
          'order.shipping_fee': 0,
          'order.total': 0,
          'order.vendor_earnings': 0,
          'order.platform_commission': 0,
          'order.payout_eligible_at': 0,
          'order.payout_status': 0,
          'order.createdAt': 0,
          'order.updatedAt': 0,
          orderItemsForBusiness: 0, // remove helper field
          walletDoc: 0,
          isWalletRelated: 0,
          isInitiatorRelated: 0
        },
      },
    ];

    const dataPipeline = [
      ...basePipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: take },
    ];

    const countPipeline = [...basePipeline, { $count: 'total' }];

    const [rows, count] = await Promise.all([
      this.transactionModel.aggregate(dataPipeline),
      this.transactionModel.aggregate(countPipeline),
    ]);

    const total = count[0]?.total || 0;

    return Utils.getPagingData({ count: total, rows }, page, size);
  }

  async findByCustomer(
    customerId: string,
    page = 1,
    size = 10,
    status?: string,
  ) {
    const { take, skip } = await Utils.getPagination(page, size);

    const filter: any = { initiator: customerId };
    if (status) filter.status = status;

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .select({
          _id: 1,
          type: 1,
          amount: 1,
          status: 1,
          reference: 1,
          description: 1,
          currency: 1,
          payment_method: 1,
          channel: 1,
          createdAt: 1,
        })
        .populate([
          {
            path: 'order',
            select: 'reference status total_price',
          },
          {
            path: 'wallet',
            select: 'balance type',
          },
        ])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .lean(),

      this.transactionModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: total, rows: transactions },
      page,
      size,
    );
  }

  async findByReference(reference: string) {
    const tx = await this.transactionModel.findOne({ reference });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  /**
   * Find the original payment transaction for an order.
   * Searches for successful checkout or wallet_checkout transactions.
   */
  async findByOrderId(orderId: string): Promise<TransactionDocument | null> {
    return this.transactionModel.findOne({
      order: new Types.ObjectId(orderId),
      status: TransactionStatus.SUCCESS,
      channel: { $in: ['checkout', 'wallet_checkout'] },
    });
  }

  async refundPaystackPayment(reference: string) {
    const transaction = await this.transactionModel.findOne({ reference });
    if (!transaction) throw new NotFoundException('Transaction not found');

    if (transaction.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException(
        'Only successful transactions can be refunded.',
      );
    }

    if (transaction.metadata?.refund?.status === 'success') {
      throw new BadRequestException(
        'This transaction has already been refunded.',
      );
    }

    const PAYSTACK_SECRET = this.configService.get<string>(
      'PAYSTACK_SECRET_KEY',
    );

    const payload: any = { transaction: reference };
    payload.amount = transaction.amount * 100; // convert to kobo

    const response: any = await firstValueFrom(
      this.httpService.post('https://api.paystack.co/refund', payload, {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
        },
      }),
    );

    const refundData = response.data.data;

    transaction.metadata = {
      ...transaction.metadata,
      refund: {
        ...refundData,
        refunded_amount: transaction.amount,
        refunded_at: new Date().toISOString(),
      },
    };

    transaction.status = TransactionStatus.REVERSED;
    await transaction.save();

    return transaction?.metadata?.order_reference;
  }

  /**
   * Partial refund via Paystack.
   * Finds the original checkout transaction for the order, and refunds a specific amount.
   * Paystack supports partial refunds natively via the `amount` field (in kobo).
   */
  async partialRefundPaystack(
    orderId: string,
    refundAmount: number,
    reason?: string,
  ): Promise<{ success: boolean; refundData?: any; error?: string }> {
    // Find the original checkout transaction for this order
    const transaction = await this.transactionModel.findOne({
      order: new Types.ObjectId(orderId),
      status: TransactionStatus.SUCCESS,
      channel: { $in: ['checkout'] },
    });

    if (!transaction) {
      return { success: false, error: 'Original checkout transaction not found' };
    }

    // Guard: can't refund more than the original transaction
    const alreadyRefunded = transaction.metadata?.total_refunded || 0;
    const maxRefundable = transaction.amount - alreadyRefunded;

    if (refundAmount > maxRefundable) {
      return {
        success: false,
        error: `Refund amount ₦${refundAmount} exceeds remaining refundable ₦${maxRefundable}`,
      };
    }

    const PAYSTACK_SECRET = this.configService.get<string>(
      'PAYSTACK_SECRET_KEY',
    );

    try {
      const payload: any = {
        transaction: transaction.reference,
        amount: Math.round(refundAmount * 100), // convert to kobo
      };

      const response: any = await firstValueFrom(
        this.httpService.post('https://api.paystack.co/refund', payload, {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET}`,
          },
        }),
      );

      const refundData = response.data.data;

      // Track cumulative partial refunds in metadata
      const partialRefunds = transaction.metadata?.partial_refunds || [];
      partialRefunds.push({
        amount: refundAmount,
        reason: reason || 'vendor_rejection',
        refunded_at: new Date().toISOString(),
        paystack_response: refundData,
      });

      transaction.metadata = {
        ...transaction.metadata,
        partial_refunds: partialRefunds,
        total_refunded: alreadyRefunded + refundAmount,
      };

      // If fully refunded, mark as reversed
      if (alreadyRefunded + refundAmount >= transaction.amount) {
        transaction.status = TransactionStatus.REVERSED;
      }

      await transaction.save();

      return { success: true, refundData };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }
}
