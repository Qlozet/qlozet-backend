import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReturnsService } from './returns.service';
import { ReturnsController } from './returns.controller';
import { Return, ReturnSchema } from './schemas/return.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { BusinessEarning, BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { PlatformSettings, PlatformSettingsSchema } from '../platform/schema/platformSettings.schema';
import { JwtService } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ProductModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Return.name, schema: ReturnSchema },
      { name: Order.name, schema: OrderSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    NotificationsModule,
    TransactionsModule,
    forwardRef(() => WalletsModule),
    ProductModule,
  ],
  controllers: [ReturnsController],
  providers: [ReturnsService, JwtService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
