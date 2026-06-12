import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentService } from './payment.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { PlatformModule } from '../platform/platform.module';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [
    HttpModule,
    TransactionsModule,
    PlatformModule,
    BusinessModule,
  ],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
