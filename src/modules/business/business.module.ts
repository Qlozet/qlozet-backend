import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { Business, BusinessSchema } from './schemas/business.schema';
import { BusinessEarning, BusinessEarningSchema } from './schemas/business-earnings.schema';
import { Warehouse, WarehouseSchema } from './schemas/warehouse.schema';
import { PlatformSettings, PlatformSettingsSchema } from '../platform/schema/platformSettings.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Wallet, WalletSchema } from '../wallets/schema/wallet.schema';
import { JwtService } from '@nestjs/jwt';
import { LogisticsService } from '../logistics/logistics.service';
import { HttpModule } from '@nestjs/axios';
import { ProductModule } from '../products/products.module';
import { BusinessEarningsCron } from './business-earning-cron';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Wallet.name, schema: WalletSchema },
    ]),
    HttpModule,
    ProductModule,
  ],
  controllers: [BusinessController],
  exports: [
    BusinessService,
    JwtService,
    LogisticsService,
    BusinessEarningsCron,
    MongooseModule,
  ],
  providers: [
    BusinessService,
    JwtService,
    LogisticsService,
    BusinessEarningsCron,
  ],
})
export class BusinessModule {}

