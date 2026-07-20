import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Wallet, WalletDocument } from './schema/wallet.schema';
import { TransactionService } from '../transactions/transactions.service';
import { TransactionType, TransactionStatus } from '../transactions/schema/transaction.schema';
import { PaymentService } from '../payment/payment.service';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
    private readonly transactionService: TransactionService,
    private readonly paymentService: PaymentService,
  ) {}

  async getOrCreateWallet(opts: { business?: string; customer?: string }) {
    const { business, customer } = opts;
    if (!business && !customer) {
      throw new BadRequestException('business or customer is required');
    }

    // 1️⃣ Search wallet by business first
    let wallet: any | null = null;

    if (business) {
      wallet = await this.walletModel.findOne({
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
    const wallet = await this.getOrCreateWallet({ business: businessId, customer: customerId });

    const transaction = await this.transactionService.create({
      initiator: wallet.customer,
      wallet: wallet.id,
      amount,
      type: TransactionType.FUND,
      channel: 'wallet_topup',
      description: `Funding wallet`,
    });

    const result = await this.paymentService.initializePaystackPayment(
      transaction.reference,
      email,
    );

    return {
      walletId: wallet._id,
      transactionId: transaction._id,
      ...result.data,
      authorization_url: result.data?.paymentUrl,
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
    const wallet = await this.getOrCreateWallet({ business: businessId, customer: customerId });
    return wallet;
  }

  /**
   * Vendor requests a withdrawal from their wallet balance.
   * Validates minimum payout, sufficient balance, and linked bank account.
   * Debits wallet immediately and queues a Paystack transfer.
   */
  async requestWithdrawal(businessId: string, amount: number) {
    const settings = await this.platformSettingsModel.findOne().lean();
    const minPayout = (settings as any)?.minimum_payout ?? 2000;

    if (amount < minPayout) {
      throw new BadRequestException(
        `Minimum withdrawal is ₦${minPayout.toLocaleString()}`,
      );
    }

    // Find vendor wallet
    const wallet = await this.walletModel.findOne({ business: businessId });
    if (!wallet) {
      throw new NotFoundException('Vendor wallet not found');
    }

    if (wallet.balance < amount) {
      throw new BadRequestException(
        `Insufficient wallet balance. Available: ₦${wallet.balance.toLocaleString()}`,
      );
    }

    // Validate vendor has a bank account linked
    const business = await this.businessModel.findById(businessId);
    if (!business?.transfer_recipient_code) {
      throw new BadRequestException(
        'Please link a bank account before withdrawing. Go to Settings → Payout.',
      );
    }

    // Debit wallet immediately (prevents double-withdrawal)
    await this.debitWallet((wallet._id as any).toString(), amount);

    // Create a pending payout transaction
    const transaction = await this.transactionService.create({
      initiator: business.created_by?.id,
      type: TransactionType.CREDIT,
      amount,
      status: TransactionStatus.PENDING,
      description: `Withdrawal request for ${business.business_name}`,
      channel: 'payout',
      metadata: {
        business_id: businessId,
        business_name: business.business_name,
        withdrawal: true,
      },
    });

    // Send payout via Paystack
    try {
      const payoutReference = await this.paymentService.sendPayout(
        businessId,
        amount,
        `Withdrawal for ${business.business_name}`,
      );

      this.logger.log(
        `[Withdrawal] ₦${amount.toLocaleString()} payout initiated for ${business.business_name} (ref: ${payoutReference})`,
      );
    } catch (err) {
      // If payout fails, reverse the wallet debit
      this.logger.error(
        `[Withdrawal] Payout failed for ${business.business_name}: ${err.message}. Reversing wallet debit.`,
      );
      await this.creditWallet((wallet._id as any).toString(), amount);
      throw new BadRequestException(
        'Withdrawal failed. Your wallet has been restored. Please try again later.',
      );
    }

    return {
      message: `Withdrawal of ₦${amount.toLocaleString()} is being processed. You'll be notified when it lands in your bank.`,
      data: { reference: transaction.reference, amount },
    };
  }
}
