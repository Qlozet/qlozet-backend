import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { TransactionService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';
import { HttpModule } from '@nestjs/axios';
import { BusinessModule } from '../business/business.module';
import { PaymentService } from '../payment/payment.service';
import { PlatformService } from '../platform/platform.service';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { CurrencyService } from '../currency/currency.service';
import { JobStatusService } from '../measurement/job-status.service';
import { ProductModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
    ]),
    BusinessModule,
    HttpModule,
    ProductModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    TransactionService,
    WalletsService,
    PaymentService,
    PlatformService,
    CurrencyService,
    JobStatusService,
  ],
})
export class WebhookModule {}

