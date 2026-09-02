import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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

// Import modules for dependencies
import { OrdersModule } from '../orders/orders.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentModule } from '../payment/payment.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductModule } from '../products/products.module';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FabricReservation.name, schema: FabricReservationSchema },
      { name: FabricClaim.name, schema: FabricClaimSchema },
    ]),
    OrdersModule,        // provides OrderService + Order model
    TransactionsModule,  // provides TransactionService
    PaymentModule,       // provides PaymentService
    PlatformModule,      // provides PlatformService
    ProductModule,       // provides Product model
    PaymentProvidersModule, // StripeProvider (verify international fee charges)
  ],
  controllers: [FabricReservationController],
  providers: [FabricReservationService],
  exports: [FabricReservationService],
})
export class FabricReservationModule {}
