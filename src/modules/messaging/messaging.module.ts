import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import {
  OrderMessage,
  OrderMessageSchema,
} from './schemas/order-message.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { AuthModule } from '../auth/auth.module';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';
import { OrderMessagesController } from './order-messages.controller';
import { AdminOrderMessagesController } from './admin-order-messages.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderMessage.name, schema: OrderMessageSchema },
      { name: Order.name, schema: OrderSchema }, // read-only: verify participation
      { name: Business.name, schema: BusinessSchema }, // resolve tailor's user id
    ]),
    AuthModule, // provides the JwtService the guards depend on
  ],
  controllers: [OrderMessagesController, AdminOrderMessagesController],
  providers: [MessagingService, MessagingGateway, JwtService],
})
export class MessagingModule {}
