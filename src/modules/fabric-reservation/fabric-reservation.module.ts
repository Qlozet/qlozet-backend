import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { FabricReservationController } from './fabric-reservation.controller';
import { FabricReservationService } from './fabric-reservation.service';
import {
  FabricReservation,
  FabricReservationSchema,
} from './schemas/fabric-reservation.schema';
import {
  FabricClaim,
  FabricClaimSchema,
} from './schemas/fabric-claim.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FabricReservation.name, schema: FabricReservationSchema },
      { name: FabricClaim.name, schema: FabricClaimSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
    HttpModule,
    OrdersModule, // Exports TransactionService, PaymentService, PlatformService, etc.
  ],
  controllers: [FabricReservationController],
  providers: [FabricReservationService],
  exports: [FabricReservationService],
})
export class FabricReservationModule {}
