import { Module } from '@nestjs/common';
import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';
import { OrderValidationService } from './orders.validation';
import { PriceCalculationService } from './orders.price-calculation';

import { JwtService } from '@nestjs/jwt';
import { TransactionService } from '../transactions/transactions.service';
import { HttpModule } from '@nestjs/axios';
import { LogisticsService } from '../logistics/logistics.service';
import { ProductService } from '../products/products.service';
import { PaymentService } from '../payment/payment.service';
import { BusinessService } from '../business/business.service';
import { PlatformService } from '../platform/platform.service';
import { DatabaseModule } from 'src/database/database.module';
import { CurrencyService } from '../currency/currency.service';
import { EventsModule } from '../recommendations/events/events.module';

@Module({
  imports: [HttpModule, DatabaseModule, EventsModule],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderValidationService,
    PriceCalculationService,
    JwtService,
    TransactionService,
    LogisticsService,
    ProductService,
    PaymentService,
    BusinessService,
    PlatformService,
    CurrencyService,
  ],
  exports: [
    OrderService,
    OrderValidationService,
    PriceCalculationService,
    JwtService,
    TransactionService,
    LogisticsService,
    ProductService,
    PaymentService,
    BusinessService,
    PlatformService,
    CurrencyService,
  ],
})
export class OrdersModule { }
