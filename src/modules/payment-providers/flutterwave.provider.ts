import { BadRequestException, Injectable } from '@nestjs/common';
import { FlutterwaveService } from '../payment/flutterwave.service';
import { NairaGatewayService } from '../payment/naira-gateway.service';
import { TransactionService } from '../transactions/transactions.service';
import {
  ChargeVerification,
  InitChargeInput,
  InitChargeResult,
  PaymentProvider,
  PayoutProvider,
  PayoutResult,
  RefundResult,
} from './provider.types';

/**
 * Flutterwave behind the provider interface: the second naira rail. Checkout
 * code normally goes through NairaGatewayService (default + failover); this
 * exists so the router can hand out Flutterwave like any other processor.
 */
@Injectable()
export class FlutterwaveProvider implements PaymentProvider, PayoutProvider {
  readonly processor = 'flutterwave' as const;

  constructor(
    private readonly flutterwave: FlutterwaveService,
    private readonly gateway: NairaGatewayService,
    private readonly transactions: TransactionService,
  ) {}

  async initCharge(input: InitChargeInput): Promise<InitChargeResult> {
    if (input.currency && input.currency !== 'NGN') {
      throw new BadRequestException(
        `Flutterwave charges are NGN only here (got ${input.currency}).`,
      );
    }
    const tx = await this.transactions.findByReference(input.reference);
    const { link } = await this.flutterwave.initialize({
      reference: input.reference,
      amount: tx.amount,
      email: input.email,
    });
    await this.transactions.attachMetadata(input.reference, {
      payment_method: 'flutterwave',
      processor: 'flutterwave',
    });
    return {
      reference: input.reference,
      authorization_url: link,
      processor: this.processor,
    };
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    const res: any = await this.gateway.verify(reference, 'flutterwave');
    return {
      reference,
      paid: res?.status === 'success',
      amount_minor:
        typeof res?.amount === 'number' ? Math.round(res.amount * 100) : undefined,
      currency: 'NGN',
      processor: this.processor,
      raw: res,
    };
  }

  async refund(reference: string): Promise<RefundResult> {
    const raw = await this.gateway.refundCard(reference);
    return { reference, processor: this.processor, ok: true, raw };
  }

  async partialRefund(reference: string, amountMinor: number): Promise<RefundResult> {
    const raw = await this.gateway.refundCard(reference, amountMinor / 100);
    return { reference, processor: this.processor, ok: true, raw };
  }

  async payout(
    businessId: string,
    amount: number,
    opts?: { reason?: string; reference?: string },
  ): Promise<PayoutResult> {
    const reference = await this.gateway.payout(
      businessId,
      amount,
      opts?.reason,
      opts?.reference,
    );
    return { reference, processor: this.processor, ok: true };
  }
}
