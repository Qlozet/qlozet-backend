import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { JobStatusService } from '../measurement/job-status.service';
import { JobStatus, JobStatusSchema } from '../../common/schemas/job-status.schema';
import { BusinessEarning, BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { PlatformSettings, PlatformSettingsSchema } from '../platform/schema/platformSettings.schema';

// Import modules instead of directly listing their services
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BusinessModule } from '../business/business.module';
import { ProductModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: JobStatus.name, schema: JobStatusSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    TransactionsModule,  // provides TransactionService
    WalletsModule,       // provides WalletsService, PaymentService, etc.
    BusinessModule,      // provides BusinessService
    ProductModule,       // provides ProductService
    OrdersModule,        // provides Order model (MongooseModule)
    NotificationsModule, // provides NotificationsService
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    JobStatusService,
  ],
})
export class WebhookModule {}
