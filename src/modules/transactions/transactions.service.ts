import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TransactionStatus,
  TransactionType,
} from './schema/transaction.schema';
import { Utils } from '../../common/utils/pagination';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';

interface CreateTransactionDto {
  initiator: string;
  business: string;
  amount: number;
  type: TransactionType;
  wallet?: string;
  order?: string;
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
  ) {}

  // ✅ Create a new transaction
  async create(dto: CreateTransactionDto): Promise<TransactionDocument> {
    const reference = await generateUniqueQlozetReference(
      this.transactionModel,
      'TRX',
    );
    const transaction = new this.transactionModel({
      initiator: new Types.ObjectId(dto.initiator),
      business: new Types.ObjectId(dto.business),
      wallet: new Types.ObjectId(dto.wallet),
      order: dto.order ? new Types.ObjectId(dto.order) : undefined,
      type: dto.type,
      amount: dto.amount,
      reference,
      description: dto.description ?? '',
      currency: dto.currency ?? 'NGN',
      payment_method: dto.payment_method ?? '',
      metadata: dto.metadata ?? {},
    });

    return transaction.save();
  }

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

  // ✅ Mark a transaction as successful
  async markSuccess(reference: string) {
    return this.updateStatus(reference, TransactionStatus.SUCCESS);
  }

  // ✅ Mark a transaction as failed
  async markFailed(reference: string) {
    return this.updateStatus(reference, TransactionStatus.FAILED);
  }

  // ✅ Get paginated transactions by business
  async findByBusiness(
    businessId: string,
    page: number = 1,
    size: number = 10,
  ) {
    const { take, skip } = await Utils.getPagination(page, size);

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find({ business: new Types.ObjectId(businessId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take),
      this.transactionModel.countDocuments({
        business: new Types.ObjectId(businessId),
      }),
    ]);

    return Utils.getPagingData(
      { count: total, rows: transactions },
      page,
      size,
    );
  }

  // ✅ Find transaction by reference
  async findByReference(reference: string) {
    const tx = await this.transactionModel.findOne({ reference });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }
}
