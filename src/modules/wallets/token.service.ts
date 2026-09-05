// src/token/token.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Token,
  TokenDocument,
  TokenTransaction,
  TokenTransactionDocument,
  TokenTransactionType,
} from './schema/token.schema';
import { CurrencyService } from '../currency/currency.service';
import { WalletsService } from './wallets.service';
import { PlatformService } from '../platform/platform.service';
import { TransactionService } from '../transactions/transactions.service';
import { TransactionType, TransactionStatus } from '../transactions/schema/transaction.schema';

@Injectable()
export class TokenService {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly walletService: WalletsService,
    private readonly platformService: PlatformService,
    private readonly transactionService: TransactionService,
    @InjectModel(Token.name) private tokenModel: Model<TokenDocument>,
    @InjectModel(TokenTransaction.name)
    private tokenTransactionModel: Model<TokenTransactionDocument>,
  ) { }

  // Token wallets are keyed by `customer` or `business` — there is no `user`
  // field on the schema. (Earlier code queried `user`, silently matching
  // nothing and orphaning wallets.)
  async findOrCreate(customer?: string, business?: string) {
    const query: any = {};
    if (customer) query.customer = new Types.ObjectId(customer);
    if (business) query.business = new Types.ObjectId(business);

    let wallet = await this.tokenModel.findOne(query);
    if (!wallet) wallet = await this.tokenModel.create(query);
    return wallet;
  }

  async get(userId: string) {
    const wallet = await this.tokenModel.findOne({
      customer: new Types.ObjectId(userId),
    });
    if (!wallet) throw new NotFoundException('Token wallet not found');
    return wallet;
  }

  async balance(business?: string, customer?: string): Promise<number> {
    // Vendor token wallets are stored as { business: id }.
    // Customer token wallets are stored as { customer: id }.
    // If both are provided (vendor request), prefer business since that's
    // where vendor tokens are stored.
    const filter: any = {};
    if (business) {
      filter.business = new Types.ObjectId(business);
    } else if (customer) {
      filter.customer = new Types.ObjectId(customer);
    }
    const wallet = await this.tokenModel.findOne(filter).lean();
    return wallet?.tokens ?? 0;
  }

  async earn(userId: string, amount: number, feature?: string, metadata?: any) {
    if (amount <= 0) throw new BadRequestException('Invalid amount');
    return this.grant({ customer: userId }, amount, feature, metadata);
  }

  /**
   * Credit free tokens to a customer or business wallet (rewards, promos).
   * Upserts the wallet, so it works even before the first purchase.
   */
  async grant(
    target: { customer?: string; business?: string },
    amount: number,
    feature?: string,
    metadata?: any,
  ) {
    if (amount <= 0) throw new BadRequestException('Invalid amount');

    const filter: any = {};
    if (target.customer) filter.customer = new Types.ObjectId(target.customer);
    if (target.business) filter.business = new Types.ObjectId(target.business);
    if (!Object.keys(filter).length)
      throw new BadRequestException('Grant target required');

    const wallet = await this.tokenModel.findOneAndUpdate(
      filter,
      { $inc: { tokens: amount, lifetimeEarned: amount } },
      { new: true, upsert: true },
    );

    // Record transaction (non-critical)
    await this.tokenTransactionModel.create({
      token: wallet._id,
      type: TokenTransactionType.EARN,
      amount,
      feature,
      metadata,
    });

    return wallet;
  }

  /**
   * One-time signup reward: pays only while the wallet's
   * `signup_reward_granted` flag is unset, then sets it — so webhook retries
   * or approve/reject/approve cycles can't pay twice. Returns null when the
   * reward was already granted.
   */
  async grantSignupReward(
    target: { customer?: string; business?: string },
    amount: number,
    feature: string,
  ) {
    if (amount <= 0) return null;

    // Ensure the wallet exists first — the guarded update below must never
    // upsert, or a second call would insert a duplicate wallet.
    const wallet = await this.findOrCreate(target.customer, target.business);

    const granted = await this.tokenModel.findOneAndUpdate(
      { _id: wallet._id, signup_reward_granted: { $ne: true } },
      {
        $inc: { tokens: amount, lifetimeEarned: amount },
        $set: { signup_reward_granted: true },
      },
      { new: true },
    );
    if (!granted) return null;

    await this.tokenTransactionModel.create({
      token: granted._id,
      type: TokenTransactionType.EARN,
      amount,
      feature,
    });

    return granted;
  }

  async spend(
    type: 'video' | 'image' | 'edit' | 'prediction' | 'ai_ask' | 'outfit' | 'analyze' | 'generate_style',
    business?: string,
    customer?: string,
    amountOverride?: number,
  ) {
    const settings = await this.platformService.getSettings();

    const priceMap = {
      image: settings.image_measurement_token_price,
      video: settings.video_measurement_token_price,
      prediction: settings.run_prediction_token_price,
      edit: settings.edit_garment_token_price,
      ai_ask: settings.ai_ask_token_price,
      outfit: settings.outfit_generation_token_price,
      analyze: (settings as any).analyze_reference_token_price ?? 10,
      generate_style: 10,
    };

    const amount = amountOverride ?? priceMap[type] ?? settings.edit_garment_token_price;

    // Customer wallets are stored as { customer: id, business: null }.
    // If both are provided, prefer customer to avoid a query mismatch.
    const tokenWalletFilter: any = {};
    if (customer) {
      tokenWalletFilter.customer = new Types.ObjectId(customer);
    } else if (business) {
      tokenWalletFilter.business = new Types.ObjectId(business);
    }

    // Atomic deduct: only succeeds if tokens >= amount (no session needed)
    const tokenWallet = await this.tokenModel.findOneAndUpdate(
      { ...tokenWalletFilter, tokens: { $gte: amount } },
      { $inc: { tokens: -amount, lifetimeSpent: amount } },
      { new: true },
    );

    if (!tokenWallet) {
      // Check if wallet exists but has insufficient tokens
      const exists = await this.tokenModel.findOne(tokenWalletFilter).lean();
      if (!exists) throw new NotFoundException('Token wallet not found');
      throw new BadRequestException('Insufficient tokens');
    }

    // Record transaction (non-critical, fire-and-forget safe)
    await this.tokenTransactionModel.create({
      token: tokenWallet._id,
      type: TokenTransactionType.SPEND,
      amount,
    });

    return tokenWallet;
  }

  /**
   * Credit tokens back after a pre-charged operation fails (tokens are spent
   * before the async generation job runs, so a failed job would otherwise lose
   * the customer's tokens). Mirrors spend()'s price map and wallet resolution.
   */
  async refund(
    type: 'video' | 'image' | 'edit' | 'prediction' | 'ai_ask' | 'outfit' | 'analyze' | 'generate_style',
    business?: string,
    customer?: string,
    amountOverride?: number,
  ) {
    const settings = await this.platformService.getSettings();

    const priceMap = {
      image: settings.image_measurement_token_price,
      video: settings.video_measurement_token_price,
      prediction: settings.run_prediction_token_price,
      edit: settings.edit_garment_token_price,
      ai_ask: settings.ai_ask_token_price,
      outfit: settings.outfit_generation_token_price,
      analyze: (settings as any).analyze_reference_token_price ?? 10,
      generate_style: 10,
    };

    const amount = amountOverride ?? priceMap[type] ?? settings.edit_garment_token_price;
    if (!amount || amount <= 0) return null;

    const tokenWalletFilter: any = {};
    if (customer) {
      tokenWalletFilter.customer = new Types.ObjectId(customer);
    } else if (business) {
      tokenWalletFilter.business = new Types.ObjectId(business);
    } else {
      return null;
    }

    const tokenWallet = await this.tokenModel.findOneAndUpdate(
      tokenWalletFilter,
      { $inc: { tokens: amount, lifetimeSpent: -amount } },
      { new: true },
    );

    if (tokenWallet) {
      await this.tokenTransactionModel.create({
        token: tokenWallet._id,
        type: TokenTransactionType.EARN,
        amount,
        feature: `refund:${type}`,
      });
    }

    return tokenWallet;
  }

  async purchase(tokenAmount: number, business?: string, customer?: string) {
    if (tokenAmount <= 0) throw new BadRequestException('Invalid token amount');

    const [wallet, tokenPrice] = await Promise.all([
      this.walletService.getWallet(customer, business),
      this.getTokenPurchasePrice(tokenAmount, 'NGN'),
    ]);

    if (!wallet || wallet.balance < tokenPrice.amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Atomic wallet debit — balance >= amount guard prevents overdraft
    const updatedWallet = await this.walletService.debitWallet(
      wallet._id.toString(),
      tokenPrice.amount,
    );

    // Credit token wallet
    const tokenWalletFilter: any = {};
    if (customer) tokenWalletFilter.customer = new Types.ObjectId(customer);
    if (business) tokenWalletFilter.business = new Types.ObjectId(business);

    const tokenWallet = await this.tokenModel.findOneAndUpdate(
      tokenWalletFilter,
      { $inc: { tokens: tokenAmount, lifetimeEarned: tokenAmount } },
      { new: true, upsert: true },
    );

    // Record token transaction
    await this.tokenTransactionModel.create({
      token: tokenWallet._id,
      type: TokenTransactionType.PURCHASE,
      amount: tokenAmount,
    });

    // Record wallet transaction (visible in transaction history)
    await this.transactionService.create({
      initiator: new Types.ObjectId(customer || business),
      wallet: wallet._id,
      amount: tokenPrice.amount,
      type: TransactionType.DEBIT,
      status: TransactionStatus.SUCCESS,
      channel: 'wallet_topup',
      description: `Purchased ${tokenAmount} token${tokenAmount > 1 ? 's' : ''}`,
    });

    return { wallet: updatedWallet, tokenWallet };
  }

  async history(userId: string, page = 1, size = 20) {
    const wallet = await this.tokenModel.findOne({
      customer: new Types.ObjectId(userId),
    });
    if (!wallet) throw new NotFoundException('Token wallet not found');

    const skip = (page - 1) * size;

    const items = await this.tokenTransactionModel
      .find({ token: wallet._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .lean();

    const total = await this.tokenTransactionModel.countDocuments({
      token: wallet._id,
    });

    return { total, page, size, items };
  }

  async expireExpiredWallets() {
    const now = new Date();
    const expired = await this.tokenModel.updateMany(
      { expiresAt: { $lte: now }, tokens: { $gt: 0 } },
      { $set: { tokens: 0 } },
    );
    return expired;
  }

  async adminAdjust(
    userId: string,
    amount: number,
    type: TokenTransactionType,
    feature?: string,
    metadata?: any,
  ) {
    const wallet = await this.findOrCreate(userId);

    const update: any = { $inc: { tokens: amount } };
    if (amount > 0) update.$inc.lifetimeEarned = amount;
    if (amount < 0) update.$inc.lifetimeSpent = Math.abs(amount);

    const updatedWallet = await this.tokenModel.findOneAndUpdate(
      { _id: wallet._id },
      update,
      { new: true },
    );

    // Record transaction (non-critical)
    await this.tokenTransactionModel.create({
      token: wallet._id,
      type,
      amount,
      feature,
      metadata,
    });

    return updatedWallet;
  }

  async getTokenPurchasePrice(tokens: number, currency: string = 'USD') {
    const pricePerTokenUsd = 0.01;
    const usdAmount = tokens * pricePerTokenUsd;

    if (currency === 'USD') {
      return { tokens, currency, amount: usdAmount };
    }

    const convertedAmount = await this.currencyService.convertUsdTo(
      usdAmount,
      currency,
    );

    return {
      tokens,
      currency,
      amount: Number(convertedAmount.toFixed(1)),
    };
  }
}
