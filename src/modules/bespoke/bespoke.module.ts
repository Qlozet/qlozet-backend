import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BespokeController } from './bespoke.controller';
import { BespokeService } from './bespoke.service';
import {
  BespokeDesign,
  BespokeDesignSchema,
} from './schemas/bespoke-design.schema';
import {
  BespokeQuote,
  BespokeQuoteSchema,
} from './schemas/bespoke-quote.schema';
import { MailService } from '../notifications/mail/mail.service';

// Import modules for dependencies
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentModule } from '../payment/payment.module';
import { BusinessModule } from '../business/business.module';
import { ProductModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BespokeDesign.name, schema: BespokeDesignSchema },
      { name: BespokeQuote.name, schema: BespokeQuoteSchema },
    ]),
    AuthModule,
    OrdersModule,        // provides Order model
    TransactionsModule,  // provides TransactionService
    PaymentModule,       // provides PaymentService
    BusinessModule,      // provides Business model
    ProductModule,       // provides Product model
  ],
  controllers: [BespokeController],
  providers: [BespokeService, MailService],
  exports: [BespokeService],
})
export class BespokeModule {}
