import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schema/transaction.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { Wallet, WalletSchema } from '../wallets/schema/wallet.schema';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Wallet.name, schema: WalletSchema },
    ]),
  ],
  controllers: [WebhookController],
  providers: [WebhookService, TransactionService, WalletsService],
})
export class WebhookModule {}
