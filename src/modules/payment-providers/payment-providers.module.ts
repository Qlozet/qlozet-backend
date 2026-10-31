import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../platform/schema/platformSettings.schema';
import { PaymentModule } from '../payment/payment.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaystackProvider } from './paystack.provider';
import { StripeProvider } from './stripe.provider';
import { FlutterwaveProvider } from './flutterwave.provider';
import { ProviderRouter } from './provider-router.service';

// Provider seam for multi-currency payments (plan Phase 1). Consumers inject
// ProviderRouter and never talk to a processor directly; StripeProvider slots
// in here in Phase 3.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    forwardRef(() => PaymentModule),
    TransactionsModule,
  ],
  providers: [PaystackProvider, FlutterwaveProvider, StripeProvider, ProviderRouter],
  exports: [ProviderRouter, PaystackProvider, FlutterwaveProvider, StripeProvider],
})
export class PaymentProvidersModule {}
