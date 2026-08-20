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
import { ObjectIdUtils } from '../../common/utils/objectId.utils';

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
      // Match whether the wallet's business ref is an ObjectId or a legacy
      // string — otherwise an existing wallet is missed and a duplicate gets
      // created below (splitting the vendor's balance across two wallets).
      wallet = await this.walletModel.findOne(
        ObjectIdUtils.refMatch('business', business),
      );
    }

    // 2️⃣ If not found and customer is provided, search by customer
    if (!wallet && customer) {
      wallet = await this.walletModel.findOne(
        ObjectIdUtils.refMatch('customer', customer),
      );
    }

    // 3️⃣ Return if found
    if (wallet) {
      return wallet;
    }

    // 4️⃣ Create wallet
    // Cast the refs to ObjectIds — the lookups above query with
    // `new Types.ObjectId(...)`, so persisting the raw string ids here would
    // make this freshly-created wallet un-findable and spawn duplicates.
    wallet = new this.walletModel({
      business: ObjectIdUtils.toObjectId(business) ?? null,
      customer: ObjectIdUtils.toObjectId(customer) ?? null,
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
    // Atomic $inc — NOT read-modify-write. Refunds are frequently issued
    // concurrently (e.g. the auto-reject cron fires many at once, often for the
    // same customer), and `balance += amount; save()` loses all but the last
    // write — so recorded refunds never reach the balance. $inc is race-safe.
    const wallet = await this.walletModel.findByIdAndUpdate(
      walletId,
      { $inc: { balance: amount }, $set: { last_transaction_at: new Date() } },
      { new: true },
    );
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  // Debit wallet
  async debitWallet(walletId: string, amount: number) {
    // Atomic conditional debit: only applies when the balance actually covers
    // it, so concurrent debits can neither overdraw nor lose updates.
    const wallet = await this.walletModel.findOneAndUpdate(
      { _id: walletId, balance: { $gte: amount } },
      { $inc: { balance: -amount }, $set: { last_transaction_at: new Date() } },
      { new: true },
    );
    if (!wallet) {
      // Disambiguate: missing wallet vs insufficient funds.
      const exists = await this.walletModel.exists({ _id: walletId });
      if (!exists) throw new NotFoundException('Wallet not found');
      throw new BadRequestException('Insufficient balance');
    }
    return wallet;
  }

  /**
   * Adjust a business wallet's ledger buckets by signed deltas.
   * Used to reverse vendor earnings on cancellations, rejections and returns
   * so the wallet stays in sync with the BusinessEarning records.
   * Buckets are clamped at 0 (consistent with earnings/penalty handling elsewhere).
   */
  async reconcileBusinessWallet(
    businessId: string | Types.ObjectId,
    deltas: { pending?: number; balance?: number },
  ) {
    const pendingDelta = deltas.pending ?? 0;
    const balanceDelta = deltas.balance ?? 0;
    if (pendingDelta === 0 && balanceDelta === 0) return null;

    const wallet = await this.walletModel.findOne(
      ObjectIdUtils.refMatch('business', businessId),
    );
    if (!wallet) {
      this.logger.warn(
        `[WalletReconcile] No wallet for business ${businessId}; skipping (pending=${pendingDelta}, balance=${balanceDelta})`,
      );
      return null;
    }

    wallet.pending_balance = Math.max(
      0,
      (wallet.pending_balance || 0) + pendingDelta,
    );
    wallet.balance = Math.max(0, (wallet.balance || 0) + balanceDelta);
    wallet.last_transaction_at = new Date();
    await wallet.save();

    this.logger.log(
      `[WalletReconcile] business=${businessId} pending${pendingDelta >= 0 ? '+' : ''}${pendingDelta} balance${balanceDelta >= 0 ? '+' : ''}${balanceDelta} → pending=${wallet.pending_balance} balance=${wallet.balance}`,
    );

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
    const wallet = await this.walletModel.findOne(
      ObjectIdUtils.refMatch('business', businessId),
    );
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

    // Create a pending payout transaction. A withdrawal is money LEAVING the
    // vendor's wallet, so it must be a DEBIT (it was previously mistyped as
    // CREDIT). Link it to the wallet so it surfaces in the vendor's ledger.
    const transaction = await this.transactionService.create({
      initiator: business.created_by?.id,
      wallet: wallet._id as any,
      type: TransactionType.DEBIT,
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
        // Reuse the DEBIT ledger entry created above — without this, sendPayout
        // creates a second transaction and the vendor sees a duplicate pair.
        transaction.reference,
      );

      this.logger.log(
        `[Withdrawal] ₦${amount.toLocaleString()} payout initiated for ${business.business_name} (ref: ${payoutReference})`,
      );
    } catch (err) {
      // If payout fails to even initiate, reverse the up-front wallet debit and
      // mark the pending payout transaction FAILED so it doesn't linger in the
      // vendor's ledger as a perpetually-pending debit.
      this.logger.error(
        `[Withdrawal] Payout failed for ${business.business_name}: ${err.message}. Reversing wallet debit.`,
      );
      await this.creditWallet((wallet._id as any).toString(), amount);
      try {
        await this.transactionService.updateStatus(
          transaction.reference,
          TransactionStatus.FAILED,
        );
      } catch (statusErr: any) {
        this.logger.error(
          `[Withdrawal] Could not mark transaction ${transaction.reference} FAILED: ${statusErr.message}`,
        );
      }
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
