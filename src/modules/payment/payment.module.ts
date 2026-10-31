import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentService } from './payment.service';
import { FlutterwaveService } from './flutterwave.service';
import { NairaGatewayService } from './naira-gateway.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { PlatformModule } from '../platform/platform.module';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [
    HttpModule,
    TransactionsModule,
    forwardRef(() => PlatformModule),  // forwardRef: OrdersModule → PaymentModule → PlatformModule → OrdersModule
    BusinessModule,
  ],
  providers: [PaymentService, FlutterwaveService, NairaGatewayService],
  exports: [PaymentService, FlutterwaveService, NairaGatewayService],
})
export class PaymentModule {}
