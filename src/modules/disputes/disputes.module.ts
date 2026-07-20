import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DisputesService } from './disputes.service';
import { DisputesController } from './disputes.controller';
import { Dispute, DisputeSchema } from './schemas/dispute.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { BusinessEarning, BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { JwtService } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Dispute.name, schema: DisputeSchema },
      { name: Order.name, schema: OrderSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
    NotificationsModule,
    TransactionsModule,
    forwardRef(() => WalletsModule),
  ],
  controllers: [DisputesController],
  providers: [DisputesService, JwtService],
  exports: [DisputesService],
})
export class DisputesModule {}
