import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PlatformController } from './platform.controller';
import { UmsModule } from '../ums/ums.module';
import { OrderService } from '../orders/orders.service';
import { DatabaseModule } from '../../database/database.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [UmsModule, OrdersModule, DatabaseModule],
  controllers: [PlatformController],
  providers: [JwtService, OrderService],
})
export class PlatformModule {}
