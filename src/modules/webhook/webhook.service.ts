import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  TransactionStatus,
  TransactionType,
} from '../transactions/schema/transaction.schema';

@Injectable()
export class WebhookService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly walletsService: WalletsService,
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
        transaction.status = TransactionStatus.SUCCESS;
        if (transaction.wallet && transaction.type === TransactionType.FUND) {
          await this.walletsService.creditWallet(
            transaction.wallet.toString(),
            transaction.amount,
          );
          walletUpdated = true;
        }
        break; // ← prevent fall-through

      case 'transfer.success':
        transaction.status = TransactionStatus.SUCCESS;
        if (transaction.wallet && transaction.type === TransactionType.DEBIT) {
          await this.walletsService.debitWallet(
            transaction.wallet.toString(),
            transaction.amount,
          );
          walletUpdated = true;
        }
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
}
