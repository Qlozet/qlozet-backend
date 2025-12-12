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
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class WalletsService {
  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    private readonly transactionService: TransactionService,
    private readonly paymentService: PaymentService,
  ) {}

  async getOrCreateWallet(business?: string, customer?: string) {
    if (!business && !customer) {
      throw new BadRequestException('business or customer is required');
    }

    // 1️⃣ Search wallet by business first
    let wallet: any | null = null;

    if (business) {
      wallet = await this.walletModel.find({
        business: new Types.ObjectId(business),
      });
    }

    // 2️⃣ If not found and customer is provided, search by customer
    if (!wallet && customer) {
      wallet = await this.walletModel.findOne({
        customer: new Types.ObjectId(customer),
      });
    }

    // 3️⃣ Return if found
    if (wallet) {
      return wallet;
    }

    // 4️⃣ Create wallet
    wallet = new this.walletModel({
      business: business ?? null,
      customer: customer ?? null,
      balance: 0,
      pending_balance: 0,
      currency: 'NGN',
    });

    await wallet.save();
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

    const result = await this.paymentService.initializePaystackPayment(
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
