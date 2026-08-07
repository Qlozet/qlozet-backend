import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OrderMessage,
  OrderMessageSchema,
} from './schemas/order-message.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { AuthModule } from '../auth/auth.module';
import { MessagingService } from './messaging.service';
import { OrderMessagesController } from './order-messages.controller';
import { AdminOrderMessagesController } from './admin-order-messages.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderMessage.name, schema: OrderMessageSchema },
      { name: Order.name, schema: OrderSchema }, // read-only: verify participation
    ]),
    AuthModule, // provides the JwtService the guards depend on
  ],
  controllers: [OrderMessagesController, AdminOrderMessagesController],
  providers: [MessagingService],
})
export class MessagingModule {}
