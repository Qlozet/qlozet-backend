import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { JobStatusService } from '../measurement/job-status.service';

// Import modules instead of directly listing their services
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BusinessModule } from '../business/business.module';
import { ProductModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TransactionsModule,  // provides TransactionService
    WalletsModule,       // provides WalletsService, PaymentService, etc.
    BusinessModule,      // provides BusinessService
    ProductModule,       // provides ProductService
    OrdersModule,        // provides Order model (MongooseModule)
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    JobStatusService,
  ],
})
export class WebhookModule {}
