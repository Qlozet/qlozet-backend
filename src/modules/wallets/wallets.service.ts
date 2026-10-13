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
import { Return, ReturnDocument, ReturnStatus } from '../returns/schemas/return.schema';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from '../business/schemas/business-earnings.schema';
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
    @InjectModel(Return.name)
    private readonly returnModel: Model<ReturnDocument>,
    @InjectModel(BusinessEarning.name)
    private readonly businessEarningsModel: Model<BusinessEarningDocument>,
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

    // Pending is bookkeeping (it mirrors the unreleased earning rows), so a
    // shortfall there is drift, not money: floor it and say so.
    const newPending = (wallet.pending_balance || 0) + pendingDelta;
    if (newPending < 0) {
      this.logger.warn(
        `[WalletReconcile] business=${businessId} pending would go to ${newPending}; flooring at 0 (earning rows and pending_balance have drifted)`,
      );
    }
    wallet.pending_balance = Math.max(0, newPending);

    // Spendable balance is real money. Taking more than it holds means the
    // vendor already withdrew it: book the difference as owed, so the next
    // release pays it back and withdrawals stay blocked until it is cleared.
    // Crediting pays owed money down first, for the same reason.
    let shortfall = 0;
    let recovered = 0;
    const before = wallet.balance || 0;
    if (balanceDelta < 0) {
      const take = Math.min(before, -balanceDelta);
      shortfall = -balanceDelta - take;
      wallet.balance = before - take;
      if (shortfall > 0) {
        wallet.owed_balance = (wallet.owed_balance || 0) + shortfall;
        this.logger.warn(
          `[WalletReconcile] business=${businessId} owed ₦${-balanceDelta} but held ₦${before}; ₦${shortfall} booked as owed (now ₦${wallet.owed_balance})`,
        );
      }
    } else if (balanceDelta > 0) {
      wallet.balance = before + balanceDelta;
      recovered = Math.min(wallet.balance, wallet.owed_balance || 0);
      if (recovered > 0) {
        wallet.balance -= recovered;
        wallet.owed_balance = (wallet.owed_balance || 0) - recovered;
      }
    }
    wallet.last_transaction_at = new Date();
    await wallet.save();
    if (recovered > 0) {
      await this.recordDebtRecovery(wallet, recovered);
    }

    this.logger.log(
      `[WalletReconcile] business=${businessId} pending${pendingDelta >= 0 ? '+' : ''}${pendingDelta} balance${balanceDelta >= 0 ? '+' : ''}${balanceDelta} → pending=${wallet.pending_balance} balance=${wallet.balance} owed=${wallet.owed_balance || 0}`,
    );

    // Callers that mirror the claw-back in the vendor's ledger book only what
    // actually left the balance; the rest is booked when it is recovered.
    (wallet as any).shortfall = shortfall;
    return wallet;
  }

  /**
   * Pay down what the vendor owes from their spendable balance. Called before
   * a withdrawal and by the release cron after a credit lands, so owed money
   * is always settled before the vendor can take anything out.
   */
  async settleOwed(businessId: string | Types.ObjectId): Promise<number> {
    const wallet = await this.walletModel.findOne(
      ObjectIdUtils.refMatch('business', businessId),
    );
    if (!wallet) return 0;
    const owed = wallet.owed_balance || 0;
    const take = Math.min(owed, wallet.balance || 0);
    if (take <= 0) return 0;
    const updated = await this.walletModel.findOneAndUpdate(
      { _id: wallet._id, balance: { $gte: take }, owed_balance: { $gte: take } },
      { $inc: { balance: -take, owed_balance: -take }, $set: { last_transaction_at: new Date() } },
      { new: true },
    );
    if (!updated) return 0;
    await this.recordDebtRecovery(updated, take);
    this.logger.log(
      `[WalletReconcile] business=${businessId} recovered ₦${take} owed → balance=${updated.balance} owed=${updated.owed_balance}`,
    );
    return take;
  }

  private async recordDebtRecovery(wallet: WalletDocument, amount: number) {
    try {
      await this.transactionService.create({
        wallet: wallet._id as any,
        type: TransactionType.DEBIT,
        amount,
        status: TransactionStatus.SUCCESS,
        channel: 'debt_recovery',
        payment_method: 'wallet',
        description: 'Recovered money owed from a refunded order',
        metadata: {
          business_id: wallet.business?.toString(),
          debt_recovery: true,
        },
      });
    } catch (err: any) {
      this.logger.warn(`[WalletReconcile] Could not record debt recovery: ${err.message}`);
    }
  }

  /**
   * Refund a customer for (part of) an order, into their wallet: instant,
   * in-app and re-spendable, and no gateway refund API in the loop. Every
   * refund path (cancellation, return, dispute) lands here with the EXACT
   * amount; the gateway-side helper refunded the whole original charge, so a
   * one-item return on a multi-vendor card order sent the entire order back.
   */
  async refundToCustomerWallet(opts: {
    order: { _id: any; reference?: string; customer?: any };
    amount: number;
    reason: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<{ walletId: string } | null> {
    const { order, amount, reason } = opts;
    if (!(amount > 0)) return null;
    const customerId = order.customer?.toString?.() ?? String(order.customer ?? '');
    if (!customerId) {
      this.logger.error(
        `[Refund] Order ${order.reference ?? order._id} has no customer; cannot refund ₦${amount}`,
      );
      return null;
    }
    const wallet = await this.getOrCreateWallet({ customer: customerId });
    const walletId = String((wallet as any)._id);
    await this.creditWallet(walletId, amount);
    await this.transactionService.create({
      initiator: new Types.ObjectId(customerId),
      order: order._id,
      wallet: (wallet as any)._id,
      type: TransactionType.REFUND,
      amount,
      status: TransactionStatus.SUCCESS,
      description:
        opts.description ?? `Refund for order ${order.reference ?? ''}: ${reason}`,
      channel: 'refund',
      metadata: {
        order_reference: order.reference,
        refund_type: 'wallet',
        reason,
        ...(opts.metadata ?? {}),
      },
    });
    this.logger.log(
      `[Refund] ₦${amount} credited to customer ${customerId}'s wallet for order ${order.reference ?? order._id} (${reason})`,
    );
    return { walletId };
  }

  /**
   * Money that must stay in the wallet while a return is open on one of the
   * vendor's orders: the released earnings on those orders are what a
   * completed return claws back, so they cannot be withdrawn first.
   */
  async withdrawalHold(businessId: string | Types.ObjectId): Promise<number> {
    const bid = new Types.ObjectId(String(businessId));
    const open = await this.returnModel
      .find({
        business: bid,
        status: {
          $in: [
            ReturnStatus.REQUESTED,
            ReturnStatus.VENDOR_APPROVED,
            ReturnStatus.RETURN_SHIPPED,
            ReturnStatus.RECEIVED,
          ],
        },
      })
      .select('order')
      .lean();
    if (!open.length) return 0;
    const orderIds = [...new Set(open.map((r: any) => String(r.order)))].map(
      (id) => new Types.ObjectId(id),
    );
    const rows = await this.businessEarningsModel.aggregate<{ _id: null; amount: number }>([
      { $match: { business: bid, order: { $in: orderIds }, released: true } },
      { $group: { _id: null, amount: { $sum: '$net_amount' } } },
    ]);
    return Math.max(0, rows[0]?.amount ?? 0);
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

    // Owed money is settled before anything can leave, and the released
    // earnings on orders with an open return stay put until it closes.
    const recovered = await this.settleOwed(businessId);
    if (recovered > 0) {
      wallet.balance = (wallet.balance || 0) - recovered;
      wallet.owed_balance = (wallet.owed_balance || 0) - recovered;
    }
    if ((wallet.owed_balance || 0) > 0) {
      throw new BadRequestException(
        `₦${(wallet.owed_balance || 0).toLocaleString()} from refunded orders is still owed; it is taken from your next earnings release before withdrawals reopen.`,
      );
    }
    const hold = await this.withdrawalHold(businessId);
    const available = Math.max(0, (wallet.balance || 0) - hold);
    if (available < amount) {
      throw new BadRequestException(
        hold > 0
          ? `Insufficient available balance. ₦${hold.toLocaleString()} is held while a return is open; available now: ₦${available.toLocaleString()}`
          : `Insufficient wallet balance. Available: ₦${available.toLocaleString()}`,
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
      // Surface the underlying reason (e.g. the Transfers-OTP guidance) so the
      // vendor knows what to fix, rather than a generic "try again later".
      const reason =
        err instanceof BadRequestException
          ? err.message
          : 'Please try again later.';
      throw new BadRequestException(
        `Withdrawal failed and your wallet has been restored. ${reason}`,
      );
    }

    return {
      message: `Withdrawal of ₦${amount.toLocaleString()} is being processed. You'll be notified when it lands in your bank.`,
      data: { reference: transaction.reference, amount },
    };
  }
}
