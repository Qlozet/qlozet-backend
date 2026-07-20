import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';
import { OrderValidationService } from './orders.validation';
import { PriceCalculationService } from './orders.price-calculation';
import { Order, OrderSchema } from './schemas/orders.schema';
import {
  CheckoutRateCache,
  CheckoutRateCacheSchema,
} from './schemas/checkout-rate-cache.schema';
import { Address, AddressSchema } from '../ums/schemas/address.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { PlatformSettings, PlatformSettingsSchema } from '../platform/schema/platformSettings.schema';
import { JwtService } from '@nestjs/jwt';

// Import modules instead of directly listing their services
import { TransactionsModule } from '../transactions/transactions.module';
import { BusinessModule } from '../business/business.module';
import { ProductModule } from '../products/products.module';
import { PaymentModule } from '../payment/payment.module';
import { CurrencyModule } from '../currency/currency.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { CartModule } from '../cart/cart.module';
import { WalletsModule } from '../wallets/wallets.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: CheckoutRateCache.name, schema: CheckoutRateCacheSchema },
      { name: Address.name, schema: AddressSchema },
      { name: User.name, schema: UserSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    TransactionsModule,  // provides TransactionService + Transaction model
    BusinessModule,      // provides BusinessService, LogisticsService + Business, BusinessEarning models
    ProductModule,       // provides ProductService + Product, Style, Fabric, Accessory, Discount models
    PaymentModule,       // provides PaymentService
    CurrencyModule,      // provides CurrencyService
    LogisticsModule,     // provides LogisticsService
    CartModule,          // provides CartService + Cart model
    forwardRef(() => WalletsModule),  // forwardRef: avoids circular dep with PlatformModule
    NotificationsModule,  // provides NotificationsService
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderValidationService,
    PriceCalculationService,
    JwtService,
  ],
  exports: [
    OrderService,
    OrderValidationService,
    PriceCalculationService,
    MongooseModule,
  ],
})
export class OrdersModule {}
