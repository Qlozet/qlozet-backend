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
      status: TransactionStatus.PENDING,
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

    const matchStage: any = {};
    if (status && status !== 'all') matchStage.status = status.toLowerCase();

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'order',
        },
      },
      { $unwind: '$order' },
      {
        $addFields: {
          order: {
            $mergeObjects: [
              '$order',
              {
                items: {
                  $filter: {
                    input: '$order.items',
                    as: 'item',
                    cond: { $eq: ['$$item.business', business] },
                  },
                },
              },
            ],
          },
        },
      },
      { $match: { 'order.items': { $ne: [] } } }, // only keep transactions that include this business
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: take },
    ];

    const [rows, count] = await Promise.all([
      this.transactionModel.aggregate(pipeline),
      this.transactionModel.aggregate([
        ...pipeline.slice(0, -3),
        { $count: 'total' },
      ]),
    ]);

    const total = count[0]?.total || 0;
    return Utils.getPagingData({ count: total, rows }, page, size);
  }

  async findByCustomer(customerId: string, page = 1, size = 10) {
    const { take, skip } = await Utils.getPagination(page, size);
    const filter = { initiator: customerId };

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .populate([
          { path: 'order', select: 'reference total_price status' },
          { path: 'wallet', select: 'balance type' },
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
}
