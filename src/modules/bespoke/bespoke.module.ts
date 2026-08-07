import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BespokeController } from './bespoke.controller';
import { AdminBespokeController } from './admin-bespoke.controller';
import { BespokeService } from './bespoke.service';
import {
  BespokeDesign,
  BespokeDesignSchema,
} from './schemas/bespoke-design.schema';
import {
  BespokeQuote,
  BespokeQuoteSchema,
} from './schemas/bespoke-quote.schema';
import { Address, AddressSchema } from '../ums/schemas/address.schema';

// Import modules for dependencies
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentModule } from '../payment/payment.module';
import { BusinessModule } from '../business/business.module';
import { ProductModule } from '../products/products.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BespokeDesign.name, schema: BespokeDesignSchema },
      { name: BespokeQuote.name, schema: BespokeQuoteSchema },
      { name: Address.name, schema: AddressSchema },
    ]),
    AuthModule,
    OrdersModule,        // provides Order model
    TransactionsModule,  // provides TransactionService
    PaymentModule,       // provides PaymentService
    BusinessModule,      // provides BusinessService + BusinessEarning/PlatformSettings models
    ProductModule,       // provides Product model
    NotificationsModule, // provides MailService
    WalletsModule,       // provides WalletsService (wallet payment)
  ],
  controllers: [BespokeController, AdminBespokeController],
  providers: [BespokeService],
  exports: [BespokeService],
})
export class BespokeModule {}
