import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
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
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { MailService } from '../notifications/mail/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BespokeDesign.name, schema: BespokeDesignSchema },
      { name: BespokeQuote.name, schema: BespokeQuoteSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
    HttpModule,
    AuthModule,
    OrdersModule, // Exports TransactionService, PaymentService, etc.
  ],
  controllers: [BespokeController],
  providers: [BespokeService, MailService],
  exports: [BespokeService],
})
export class BespokeModule {}
