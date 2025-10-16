import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction, TransactionDocument } from './schema/transaction.schema';
import { Utils } from 'src/common/utils/pagination';

@Injectable()
export class TransactionService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
  ) {}

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
}
