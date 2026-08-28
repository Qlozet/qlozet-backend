import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import {
  ChargeVerification,
  InitChargeInput,
  InitChargeResult,
  PaymentProvider,
  RefundResult,
} from './provider.types';

/**
 * Stripe behind the provider interface — the international / Qlozet, Inc. (US)
 * rail (multi-currency plan Phase 3). Charges use redirect-style Checkout
 * Sessions so the frontend flow matches Paystack (redirect to
 * `authorization_url`, return to /payment/verify). The ledger transaction
 * reference rides on `client_reference_id` + PaymentIntent metadata, which is
 * how the webhook and verifyCharge find their way back.
 *
 * PayoutProvider (Stripe Connect) is Phase 4 — this class is charging only.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly processor = 'stripe' as const;
  private readonly logger = new Logger(StripeProvider.name);
  private client: Stripe | null = null;

  /** Lazy so the app boots fine without keys until Stripe is actually used. */
  private stripe(): Stripe {
    if (this.client) return this.client;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        'International payments are not configured yet.',
      );
    }
    this.client = new Stripe(key);
    return this.client;
  }

  async initCharge(input: InitChargeInput): Promise<InitChargeResult> {
    const currency = (input.currency || 'USD').toLowerCase();
    if (currency === 'ngn') {
      throw new BadRequestException('NGN charges are routed to Paystack.');
    }
    if (!input.amount_minor || input.amount_minor < 1) {
      throw new BadRequestException('Charge amount is required for Stripe.');
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || '';
    const session = await this.stripe().checkout.sessions.create({
      mode: 'payment',
      client_reference_id: input.reference,
      customer_email: input.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: input.amount_minor,
            product_data: { name: `Qlozet order ${input.reference}` },
          },
        },
      ],
      payment_intent_data: {
        metadata: { reference: input.reference },
      },
      metadata: { reference: input.reference },
      success_url: `${FRONTEND_URL}/payment/verify?reference=${encodeURIComponent(input.reference)}`,
      cancel_url: `${FRONTEND_URL}/cart`,
    });

    return {
      reference: input.reference,
      authorization_url: session.url ?? undefined,
      session_id: session.id,
      processor: this.processor,
    };
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    // The reference is stamped on the PaymentIntent's metadata at init; the
    // Search API finds it without us having stored the session id anywhere.
    const found = await this.stripe().paymentIntents.search({
      query: `metadata['reference']:'${reference.replace(/'/g, '')}'`,
      limit: 1,
    });
    const pi = found.data[0];
    return {
      reference,
      paid: pi?.status === 'succeeded',
      amount_minor: pi?.amount_received ?? pi?.amount,
      currency: pi?.currency?.toUpperCase(),
      processor: this.processor,
      raw: pi ?? null,
    };
  }

  async refund(reference: string): Promise<RefundResult> {
    const pi = await this.requirePaymentIntent(reference);
    const raw = await this.stripe().refunds.create({ payment_intent: pi.id });
    return { reference, processor: this.processor, ok: true, raw };
  }

  async partialRefund(
    reference: string,
    amountMinor: number,
  ): Promise<RefundResult> {
    const pi = await this.requirePaymentIntent(reference);
    const raw = await this.stripe().refunds.create({
      payment_intent: pi.id,
      amount: Math.round(amountMinor),
    });
    return { reference, processor: this.processor, ok: true, raw };
  }

  /** Verify a webhook payload's signature and return the parsed event. */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'Stripe webhook secret not configured.',
      );
    }
    return this.stripe().webhooks.constructEvent(rawBody, signature, secret);
  }

  private async requirePaymentIntent(
    reference: string,
  ): Promise<Stripe.PaymentIntent> {
    const found = await this.stripe().paymentIntents.search({
      query: `metadata['reference']:'${reference.replace(/'/g, '')}'`,
      limit: 1,
    });
    const pi = found.data[0];
    if (!pi) {
      throw new BadRequestException(
        `No Stripe payment found for reference ${reference}.`,
      );
    }
    return pi;
  }
}
