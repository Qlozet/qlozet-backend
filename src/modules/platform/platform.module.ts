import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformSettings, PlatformSettingsSchema } from './schema/platformSettings.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { UmsModule } from '../ums/ums.module';
import { OrderService } from '../orders/orders.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    UmsModule,
    OrdersModule,
  ],
  controllers: [PlatformController],
  providers: [JwtService, OrderService],
  exports: [PlatformService, MongooseModule],
})
export class PlatformModule {}
