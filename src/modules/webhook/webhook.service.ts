import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  TransactionDocument,
  TransactionStatus,
  TransactionType,
} from '../transactions/schema/transaction.schema';
import { BusinessService } from '../business/business.service';
import { Order } from '../orders/schemas/orders.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class WebhookService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
    private readonly businessService: BusinessService,

    @InjectModel('Order') private orderModel: Model<Order>,
  ) {}
  async handlePaystackWebhook(payload: any) {
    const { event, data } = payload;

    const transaction = await this.transactionService
      .findByReference(data.reference)
      .catch(() => null);

    if (!transaction)
      return { status: 'ignored', message: 'Transaction not found' };

    let walletUpdated = false;

    switch (event) {
      case 'charge.success':
        walletUpdated = await this.handleChargeSuccess(transaction);
        transaction.status = TransactionStatus.SUCCESS;
        break;

      case 'transfer.success':
        walletUpdated = await this.handleTransferSuccess(transaction);
        transaction.status = TransactionStatus.SUCCESS;
        break;

      case 'charge.failed':
      case 'transfer.failed':
        transaction.status = TransactionStatus.FAILED;
        break;

      default:
        break;
    }

    transaction.metadata = {
      ...transaction.metadata,
      webhook: data,
      last_event: event,
      processed_at: new Date().toISOString(),
    };

    await transaction.save();

    return {
      status: 'success',
      received: true,
      reference: transaction.reference,
      walletUpdated,
    };
  }

  // ------------------------ Helpers ------------------------

  private async handleChargeSuccess(
    transaction: TransactionDocument,
  ): Promise<boolean> {
    transaction.status = TransactionStatus.SUCCESS;
    let walletUpdated = false;

    if (transaction.wallet && transaction.type === TransactionType.FUND) {
      await this.walletsService.creditWallet(
        transaction.wallet.toString(),
        transaction.amount,
      );
      walletUpdated = true;
    }

    return walletUpdated;
  }

  private async handleTransferSuccess(
    transaction: TransactionDocument,
  ): Promise<boolean> {
    transaction.status = TransactionStatus.SUCCESS;
    let walletUpdated = false;

    // Vendor payout
    if (
      transaction.type === TransactionType.CREDIT &&
      transaction.channel === 'payout'
    ) {
      await this.processVendorPayout(transaction);
    }

    // Wallet debit if applicable
    if (transaction.wallet && transaction.type === TransactionType.DEBIT) {
      await this.walletsService.debitWallet(
        transaction.wallet.toString(),
        transaction.amount,
      );
      walletUpdated = true;
    }

    return walletUpdated;
  }

  private async processVendorPayout(transaction: TransactionDocument) {
    const businessId = transaction.initiator as unknown as string;
    const business = await this.businessService.findBusinessById(businessId);
    if (!business) return;

    // Compute vendor earnings

    business.lifetime_paid_out =
      (business.lifetime_paid_out || 0) + transaction.amount;
    business.pending_payout_balance = 0;
    business.last_payout_date = new Date();
    business.payout_history = business.payout_history || [];
    business.payout_history.push(transaction.reference);
    await business.save();

    await this.orderModel.updateMany(
      { 'items.business': business._id, payout_status: 'eligible' },
      { $set: { payout_status: 'paid' } },
    );
  }
}
