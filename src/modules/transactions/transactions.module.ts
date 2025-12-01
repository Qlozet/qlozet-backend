import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { TransactionController } from './transactions.controller';
import { TransactionService } from './transactions.service';
import { Transaction, TransactionSchema } from './schema/transaction.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';
import { HttpModule, HttpService } from '@nestjs/axios';
import { PaystackWebhookMiddleware } from 'src/common/guards/paystack.guard';
import { BusinessService } from '../business/business.service';
import { BusinessModule } from '../business/business.module';
import { BusinessSchema, Business } from '../business/schemas/business.schema';
import {
  WarehouseSchema,
  Warehouse,
} from '../business/schemas/warehouse.schema';
import { DatabaseModule } from 'src/database/database.module';
import { ProductModule } from '../products/products.module';

@Module({
  imports: [HttpModule, BusinessModule, DatabaseModule, ProductModule],
  controllers: [TransactionController],
  providers: [TransactionService, JwtService],
})
export class TransactionsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PaystackWebhookMiddleware).forRoutes({
      path: 'transactions/paystack/webhook',
      method: RequestMethod.POST,
    });
  }
}
