import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Wallet, WalletDocument } from './schema/wallet.schema';
import { TransactionService } from '../transactions/transactions.service';
import { TransactionType } from '../transactions/schema/transaction.schema';

@Injectable()
export class WalletsService {
  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    private readonly transactionService: TransactionService,
  ) {}

  async getOrCreateWallet(
    customerId?: string,
    businessId?: string,
  ): Promise<WalletDocument> {
    if (!customerId && !businessId)
      throw new BadRequestException('customerId or businessId is required');

    const filter: any = {};
    if (customerId) filter.customer = customerId;
    if (businessId) filter.business = businessId;

    let wallet = await this.walletModel.findOne(filter);
    if (!wallet) {
      wallet = new this.walletModel({
        customer: customerId ?? undefined,
        business: businessId ?? undefined,
        balance: 0,
        currency: 'NGN',
      });
      await wallet.save();
    }
    return wallet;
  }

  // Fund wallet
  async fundWallet(
    amount: number,
    email: string,
    customerId?: string,
    businessId?: string,
  ) {
    const wallet = await this.getOrCreateWallet(customerId, businessId);

    const transaction = await this.transactionService.create({
      initiator: wallet.customer,
      wallet: wallet.id,
      amount,
      type: TransactionType.FUND,
      channel: 'paystack',
      description: `Funding wallet`,
    });

    const result = await this.transactionService.initializePaystackPayment(
      transaction.id,
      email,
    );

    return {
      walletId: wallet._id,
      transactionId: transaction._id,
      ...result.data,
    };
  }

  // Credit wallet after successful funding
  async creditWallet(walletId: string, amount: number) {
    const wallet = await this.walletModel.findById(walletId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    wallet.balance += amount;
    wallet.last_transaction_at = new Date();
    await wallet.save();

    return wallet;
  }

  // Debit wallet
  async debitWallet(walletId: string, amount: number) {
    const wallet = await this.walletModel.findById(walletId);
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.balance < amount)
      throw new BadRequestException('Insufficient balance');

    wallet.balance -= amount;
    wallet.last_transaction_at = new Date();
    await wallet.save();

    return wallet;
  }

  // Get wallet balance
  async getWallet(customerId?: string, businessId?: string) {
    const wallet = await this.getOrCreateWallet(customerId, businessId);
    return wallet;
  }
}
