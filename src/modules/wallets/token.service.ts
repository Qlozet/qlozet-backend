// src/token/token.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, startSession } from 'mongoose';
import {
  Token,
  TokenDocument,
  TokenTransaction,
  TokenTransactionDocument,
  TokenTransactionType,
} from './schema/token.schema';
import { CurrencyService } from '../currency/currency.service';
import { WalletsService } from './wallets.service';

@Injectable()
export class TokenService {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly walletService: WalletsService,
    @InjectModel(Token.name) private tokenModel: Model<TokenDocument>,
    @InjectModel(TokenTransaction.name)
    private transactionModel: Model<TokenTransactionDocument>,
  ) {}

  async findOrCreate(user?: string, business?: string) {
    const query: any = {};
    if (user) query.user = new Types.ObjectId(user);
    if (business) query.business = new Types.ObjectId(business);

    let wallet = await this.tokenModel.findOne(query);
    if (!wallet) wallet = await this.tokenModel.create(query);
    return wallet;
  }

  async get(userId: string) {
    const wallet = await this.tokenModel.findOne({
      user: new Types.ObjectId(userId),
    });
    if (!wallet) throw new NotFoundException('Token wallet not found');
    return wallet;
  }

  async balance(business?: string, customer?: string): Promise<number> {
    const filter: any = {};
    if (business) filter.business = new Types.ObjectId(business);
    if (customer) filter.customer = new Types.ObjectId(customer);
    const wallet = await this.tokenModel.findOne(filter).lean();
    return wallet?.tokens ?? 0;
  }

  async earn(userId: string, amount: number, feature?: string, metadata?: any) {
    if (amount <= 0) throw new BadRequestException('Invalid amount');

    const session = await startSession();
    session.startTransaction();

    try {
      const wallet = await this.tokenModel.findOneAndUpdate(
        { user: new Types.ObjectId(userId) },
        { $inc: { tokens: amount, lifetimeEarned: amount } },
        { new: true, upsert: true, session },
      );

      await this.transactionModel.create(
        [
          {
            wallet: wallet._id,
            type: TokenTransactionType.EARN,
            amount,
            feature,
            metadata,
          },
        ],
        { session },
      );

      await session.commitTransaction();
      return wallet;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }

  async spend(type: 'video' | 'image', business?: string, customer?: string) {
    const tokenCostMap = { image: 25, video: 45 };
    const amount = tokenCostMap[type];

    if (!amount || amount <= 0)
      throw new BadRequestException('Invalid token type');

    const session = await startSession();
    session.startTransaction();

    try {
      const tokenWalletFilter: any = {};
      if (business) tokenWalletFilter.business = new Types.ObjectId(business);
      if (customer) tokenWalletFilter.customer = new Types.ObjectId(customer);

      const tokenWallet = await this.tokenModel
        .findOne(tokenWalletFilter)
        .session(session);
      if (!tokenWallet) throw new NotFoundException('Token wallet not found');

      if (tokenWallet.tokens < amount) {
        throw new BadRequestException('Insufficient tokens');
      }

      // Deduct tokens
      tokenWallet.tokens -= amount;
      tokenWallet.lifetimeSpent += amount;
      await tokenWallet.save({ session });

      // Record transaction
      await this.transactionModel.create(
        {
          wallet: tokenWallet._id,
          type: TokenTransactionType.SPEND,
          amount,
        },
        { session },
      );

      await session.commitTransaction();
      return tokenWallet;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
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

    const session = await startSession();
    session.startTransaction();

    try {
      wallet.balance -= tokenPrice.amount;
      wallet.last_transaction_at = new Date();
      await wallet.save({ session });

      const tokenWalletFilter: any = {};
      if (customer) tokenWalletFilter.customer = new Types.ObjectId(customer);
      if (business) tokenWalletFilter.business = new Types.ObjectId(business);

      const tokenWallet = await this.tokenModel.findOneAndUpdate(
        tokenWalletFilter,
        { $inc: { tokens: tokenAmount, lifetimeEarned: tokenAmount } },
        { new: true, upsert: true, session },
      );

      await this.transactionModel.create(
        {
          wallet: tokenWallet._id,
          type: TokenTransactionType.PURCHASE,
          amount: tokenAmount,
        },
        { session },
      );

      await session.commitTransaction();
      return { wallet, tokenWallet };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async history(userId: string, page = 1, size = 20) {
    const wallet = await this.tokenModel.findOne({
      user: new Types.ObjectId(userId),
    });
    if (!wallet) throw new NotFoundException('Token wallet not found');

    const skip = (page - 1) * size;

    const items = await this.transactionModel
      .find({ wallet: wallet._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .lean();

    const total = await this.transactionModel.countDocuments({
      wallet: wallet._id,
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
    const session = await startSession();
    session.startTransaction();

    try {
      const wallet = await this.findOrCreate(userId);

      wallet.tokens += amount;
      if (amount > 0) wallet.lifetimeEarned += amount;
      if (amount < 0) wallet.lifetimeSpent += Math.abs(amount);

      await wallet.save({ session });

      await this.transactionModel.create(
        [
          {
            wallet: wallet._id,
            type,
            amount,
            feature,
            metadata,
          },
        ],
        { session },
      );

      await session.commitTransaction();
      return wallet;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
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
