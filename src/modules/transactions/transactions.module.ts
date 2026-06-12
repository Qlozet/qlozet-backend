import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionController } from './transactions.controller';
import { TransactionService } from './transactions.service';
import { Transaction, TransactionSchema } from './schema/transaction.schema';
import { JwtService } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { PaystackWebhookMiddleware } from 'src/common/guards/paystack.guard';
import { BusinessModule } from '../business/business.module';
import { ProductModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    HttpModule,
    BusinessModule,
    ProductModule,
  ],
  controllers: [TransactionController],
  providers: [TransactionService, JwtService],
  exports: [TransactionService, MongooseModule],
})
export class TransactionsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PaystackWebhookMiddleware).forRoutes({
      path: 'transactions/paystack/webhook',
      method: RequestMethod.POST,
    });
  }
}
