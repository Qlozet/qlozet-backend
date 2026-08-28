import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';
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
 * Paystack behind the provider interface — the NGN / Qlozet-Nigeria rail.
 * Thin delegation onto the existing PaymentService / TransactionService so
 * behaviour is byte-for-byte what shipped before the abstraction (Phase 1
 * introduces the seam, not new behaviour).
 */
@Injectable()
export class PaystackProvider implements PaymentProvider, PayoutProvider {
  readonly processor = 'paystack' as const;

  constructor(
    private readonly paymentService: PaymentService,
    private readonly transactionService: TransactionService,
  ) {}

  async initCharge(input: InitChargeInput): Promise<InitChargeResult> {
    if (input.currency && input.currency !== 'NGN') {
      throw new BadRequestException(
        `Paystack charges are NGN only (got ${input.currency}).`,
      );
    }
    const res: any = await this.paymentService.initializePaystackPayment(
      input.reference,
      input.email,
    );
    return {
      ...res,
      reference: input.reference,
      processor: this.processor,
    };
  }

  async verifyCharge(reference: string): Promise<ChargeVerification> {
    const res: any = await this.paymentService.verifyPaystackPayment(reference);
    return {
      reference,
      paid: res?.status === 'success',
      // Ledger amounts are ₦ major units today; minor-units migration is a
      // separate Phase 1 workstream (see plan §15 rounding).
      amount_minor:
        typeof res?.amount === 'number'
          ? Math.round(res.amount * 100)
          : undefined,
      currency: 'NGN',
      processor: this.processor,
      raw: res,
    };
  }

  async refund(reference: string): Promise<RefundResult> {
    const raw = await this.transactionService.refundPaystackPayment(reference);
    return { reference, processor: this.processor, ok: true, raw };
  }

  async partialRefund(
    reference: string,
    amountMinor: number,
  ): Promise<RefundResult> {
    // partialRefundPaystack takes ₦ major units.
    const raw = await this.transactionService.partialRefundPaystack(
      reference,
      amountMinor / 100,
    );
    return { reference, processor: this.processor, ok: true, raw };
  }

  async payout(
    businessId: string,
    amount: number,
    opts?: { reason?: string; reference?: string },
  ): Promise<PayoutResult> {
    const raw = await this.paymentService.sendPayout(
      businessId,
      amount,
      opts?.reason,
      opts?.reference,
    );
    return {
      reference: opts?.reference,
      processor: this.processor,
      ok: true,
      raw,
    };
  }
}
