import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { PaystackProvider } from './paystack.provider';
import { StripeProvider } from './stripe.provider';
import {
  PaymentProvider,
  PayoutProvider,
  Processor,
  PROCESSOR_ENTITY,
  SettlementEntity,
} from './provider.types';

/**
 * Picks the processor for a currency. Charging: presentment currency; payouts:
 * the vendor's settlement currency (business.default_currency). Backed by the
 * `currency_processor_map` platform setting, defaulting to NGN→paystack /
 * everything-else→stripe. Stripe resolves once Phase 3 lands AND
 * `stripe_enabled` is on — until then non-NGN routing throws a clear error
 * instead of silently mischarging.
 */
@Injectable()
export class ProviderRouter {
  constructor(
    @InjectModel(PlatformSettings.name)
    private readonly settingsModel: Model<PlatformSettingsDocument>,
    private readonly paystack: PaystackProvider,
    private readonly stripeProvider: StripeProvider,
  ) {}

  async processorFor(currency: string): Promise<Processor> {
    const ccy = (currency || 'NGN').toUpperCase();
    const settings: any = await this.settingsModel.findOne().lean();
    const map: Record<string, string> = settings?.currency_processor_map ?? {};
    const chosen = (map[ccy] ?? map.default ?? (ccy === 'NGN' ? 'paystack' : 'stripe')) as Processor;
    if (chosen === 'stripe' && !settings?.stripe_enabled) {
      throw new BadRequestException(
        `Payments in ${ccy} are not available yet.`,
      );
    }
    return chosen;
  }

  entityFor(processor: Processor): SettlementEntity {
    return PROCESSOR_ENTITY[processor];
  }

  async paymentProviderFor(currency: string): Promise<PaymentProvider> {
    const processor = await this.processorFor(currency);
    return this.byProcessor(processor);
  }

  async payoutProviderFor(currency: string): Promise<PayoutProvider> {
    const processor = await this.processorFor(currency);
    if (processor !== 'paystack') {
      // Stripe Connect payouts are Phase 4.
      throw new BadRequestException(
        'International payouts are not available yet.',
      );
    }
    return this.paystack;
  }

  private byProcessor(processor: Processor): PaymentProvider & Partial<PayoutProvider> {
    switch (processor) {
      case 'paystack':
        return this.paystack;
      case 'stripe':
        // Charging only for now — Connect payouts land in Phase 4.
        return this.stripeProvider;
      default:
        throw new BadRequestException(`Unknown processor "${processor}".`);
    }
  }
}
