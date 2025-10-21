import { Module } from '@nestjs/common';
import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';

@Module({
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrdersModule {}
