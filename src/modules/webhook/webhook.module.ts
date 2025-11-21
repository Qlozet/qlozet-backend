import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import { HttpModule } from '@nestjs/axios';
import { BusinessModule } from '../business/business.module';
import { PaymentService } from '../payment/payment.service';
import { PlatformService } from '../platform/platform.service';

import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [BusinessModule, HttpModule, DatabaseModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    TransactionService,
    WalletsService,
    PaymentService,
    PlatformService,
  ],
})
export class WebhookModule {}
