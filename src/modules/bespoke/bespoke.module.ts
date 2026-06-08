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
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { MailService } from '../notifications/mail/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BespokeDesign.name, schema: BespokeDesignSchema },
      { name: BespokeQuote.name, schema: BespokeQuoteSchema },
    ]),
    HttpModule,
    DatabaseModule,
    AuthModule,
    OrdersModule, // Exports TransactionService, PaymentService, etc.
  ],
  controllers: [BespokeController],
  providers: [BespokeService, MailService],
  exports: [BespokeService],
})
export class BespokeModule {}
