import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { PaymentService } from './payment.service';
import { FlutterwaveService } from './flutterwave.service';
import { TransactionService } from '../transactions/transactions.service';
import {
  TransactionStatus,
  TransactionType,
} from '../transactions/schema/transaction.schema';
import { PlatformService } from '../platform/platform.service';
import {
  Business,
  BusinessDocument,
} from '../business/schemas/business.schema';

export type NairaProcessor = 'paystack' | 'flutterwave';

/** How long a provider that just failed is skipped before we try it first again. */
const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Naira card payments across two providers.
 *
 * Every naira checkout (orders, bespoke, wallet top-ups, fabric reservation
 * fees) starts here. The admin picks the default provider (`naira_processor`);
 * if it cannot start a payment, the other one is tried, and a provider that
 * just failed is skipped for a few minutes so customers aren't sent to a dead
 * checkout. Flutterwave only joins once `flutterwave_enabled` is on AND its
 * key is set.
 *
 * The provider that took a payment is stamped on the transaction
 * (`metadata.payment_method`), and every later check, webhook and refund goes
 * back to that provider.
 *
 * Payouts stay on Paystack (vendors' bank recipients live there). With
 * `flutterwave_payouts_enabled`, a payout Paystack clearly refused (for
 * example, not enough balance) is sent through Flutterwave instead.
 */
@Injectable()
export class NairaGatewayService {
  private readonly logger = new Logger(NairaGatewayService.name);
  private readonly failedAt: Partial<Record<NairaProcessor, number>> = {};

  constructor(
    private readonly paystack: PaymentService,
    private readonly flutterwave: FlutterwaveService,
    private readonly transactions: TransactionService,
    private readonly platformService: PlatformService,
    private readonly config: ConfigService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async settings(): Promise<any> {
    try {
      return await this.platformService.getSettings();
    } catch {
      return {};
    }
  }

  private flutterwaveOn(settings: any): boolean {
    return !!settings?.flutterwave_enabled && this.flutterwave.isConfigured();
  }

  /** Providers to try, best first. */
  async order(): Promise<NairaProcessor[]> {
    const s = await this.settings();
    const preferred: NairaProcessor =
      s?.naira_processor === 'flutterwave' ? 'flutterwave' : 'paystack';
    let list: NairaProcessor[] =
      preferred === 'flutterwave' ? ['flutterwave', 'paystack'] : ['paystack', 'flutterwave'];
    if (!this.flutterwaveOn(s)) list = list.filter((p) => p !== 'flutterwave');
    // A provider that failed in the last few minutes goes to the back.
    const now = Date.now();
    const cooling = (p: NairaProcessor) => now - (this.failedAt[p] ?? 0) < COOLDOWN_MS;
    return [...list.filter((p) => !cooling(p)), ...list.filter(cooling)];
  }

  /**
   * Start a naira card payment for an existing ledger transaction. Returns the
   * same shape the Paystack-only code returned (`data.paymentUrl`), plus the
   * provider that took it.
   */
  async initialize(
    reference: string,
    email: string,
    opts: { returnTo?: 'shop' | 'vendor' } = {},
  ) {
    const providers = await this.order();
    const returnUrl = this.returnUrl(reference, opts.returnTo);
    let lastError: any;
    for (const processor of providers) {
      try {
        const result =
          processor === 'flutterwave'
            ? await this.initFlutterwave(reference, email, returnUrl)
            : await this.paystack.initializePaystackPayment(
                reference,
                email,
                opts.returnTo === 'vendor' ? returnUrl : undefined,
              );
        await this.stampProcessor(reference, processor);
        delete this.failedAt[processor];
        return {
          ...result,
          data: { ...(result as any).data, processor },
        };
      } catch (error: any) {
        // A missing transaction is our bug, not the provider's; don't hop.
        if (error instanceof NotFoundException) throw error;
        lastError = error;
        this.failedAt[processor] = Date.now();
        const next = providers[providers.indexOf(processor) + 1];
        this.logger.warn(
          `[NairaGateway] ${processor} could not start ${reference}: ${error?.message}` +
            (next ? ` — trying ${next}` : ''),
        );
      }
    }
    throw lastError;
  }

  /**
   * Where the customer lands after paying. The shop's /payment/verify and the
   * vendor app's /wallet both read ?reference=; Flutterwave appends its own
   * status/tx_ref/transaction_id after it.
   */
  private returnUrl(reference: string, to: 'shop' | 'vendor' = 'shop') {
    const shop = this.config.get<string>('FRONTEND_URL');
    const ref = encodeURIComponent(reference);
    if (to === 'vendor') {
      const vendor = this.config.get<string>('VENDOR_FRONTEND_URL') || shop;
      return vendor ? `${vendor}/wallet?reference=${ref}` : undefined;
    }
    return shop ? `${shop}/payment/verify?reference=${ref}` : undefined;
  }

  private async initFlutterwave(
    reference: string,
    email: string,
    redirectUrl: string | undefined,
  ) {
    const tx = await this.transactions.findByReference(reference);
    const { link } = await this.flutterwave.initialize({
      reference,
      amount: tx.amount,
      email,
      currency: tx.currency || 'NGN',
      redirectUrl,
    });
    await this.transactions.attachMetadata(reference, {
      flutterwave: { link, initialized_at: new Date().toISOString() },
    });
    return {
      success: true,
      message: 'Payment initialized successfully',
      data: {
        paymentUrl: link,
        authorization_url: link,
        reference,
        amount: tx.amount,
      },
    };
  }

  /** Record which provider took the payment, on the transaction and its order. */
  private async stampProcessor(reference: string, processor: NairaProcessor) {
    await this.transactions.attachMetadata(reference, {
      payment_method: processor,
      processor,
    });
    const tx: any = await this.transactions.findByReference(reference).catch(() => null);
    if (tx) {
      tx.payment_method = processor;
      await tx.save().catch(() => undefined);
      const Order = this.connection.models['Order'];
      if (tx.order && Order) {
        await Order.updateOne(
          { _id: tx.order },
          { $set: { processor } },
        ).catch(() => undefined);
      }
    }
  }

  /** Which provider a ledger transaction was charged through. */
  processorOf(tx: any): NairaProcessor {
    return tx?.metadata?.payment_method === 'flutterwave' ? 'flutterwave' : 'paystack';
  }

  /**
   * Confirm a payment with the provider that took it and settle the ledger
   * transaction. Same result shape as PaymentService.verifyPaystackPayment.
   * `force` checks a specific provider (a Flutterwave webhook, say) regardless
   * of the stamp.
   */
  async verify(reference: string, force?: NairaProcessor) {
    const tx: any = await this.transactions.findByReference(reference);
    const processor = force ?? this.processorOf(tx);
    if (processor === 'paystack') {
      return this.paystack.verifyPaystackPayment(reference);
    }

    const shape = (alreadyProcessed: boolean, status: string, message: string) => ({
      success: true,
      status,
      reference,
      amount: tx.amount,
      walletId: tx.wallet?.toString() || null,
      transactionType: tx.type,
      alreadyProcessed,
      processor,
      message,
    });

    if (tx.status === TransactionStatus.SUCCESS) {
      return shape(true, TransactionStatus.SUCCESS, 'Payment verified successfully');
    }

    const charge = await this.flutterwave.verify(reference);
    if (charge.status === 'successful') {
      // Never trust the redirect or webhook alone: the charged amount and
      // currency must cover what we asked for.
      const ccy = (tx.currency || 'NGN').toUpperCase();
      const enough =
        (charge.currency || '').toUpperCase() === ccy &&
        (charge.amount ?? 0) + 0.01 >= tx.amount;
      if (!enough) {
        this.logger.error(
          `[NairaGateway] Flutterwave ${reference} paid ${charge.amount} ${charge.currency}, expected ${tx.amount} ${ccy} — not settling.`,
        );
        await this.transactions.attachMetadata(reference, {
          amount_mismatch: { paid: charge.amount, currency: charge.currency },
        });
        return shape(false, tx.status, 'Payment amount does not match');
      }
      const updated = await this.transactions.settleOnce(reference, {
        'metadata.flutterwave_charge': {
          id: charge.id,
          amount: charge.amount,
          currency: charge.currency,
          flw_ref: charge.raw?.flw_ref,
          paid_at: charge.raw?.created_at,
        },
        'metadata.payment_method': 'flutterwave',
      });
      return shape(!updated, TransactionStatus.SUCCESS, 'Payment verified successfully');
    }
    if (charge.status === 'failed') {
      await this.transactions.markFailed(reference);
      return shape(false, TransactionStatus.FAILED, 'Payment failed or incomplete');
    }
    // Not paid yet (or still processing): leave it pending.
    return shape(false, tx.status, 'Payment failed or incomplete');
  }

  /** Full or partial (naira) card refund through the provider that charged. */
  async refundCard(reference: string, amount?: number) {
    const tx: any = await this.transactions.findByReference(reference);
    if (this.processorOf(tx) === 'flutterwave') {
      const id = tx.metadata?.flutterwave_charge?.id;
      if (!id) throw new BadRequestException('No Flutterwave charge on this transaction.');
      return this.flutterwave.refund(id, amount);
    }
    // Paystack refunds live on TransactionService.
    return amount != null
      ? this.transactions.partialRefundPaystack(reference, amount)
      : this.transactions.refundPaystackPayment(reference);
  }

  /**
   * Pay a vendor. Paystack first; if Paystack clearly refused (no recipient,
   * not enough balance, a 4xx) and Flutterwave payouts are on, send it via
   * Flutterwave under the same ledger reference. A timeout or 5xx never hops:
   * Paystack may still deliver it, and sending twice pays the vendor twice.
   */
  async payout(
    businessId: string,
    amount: number,
    reason?: string,
    existingReference?: string,
  ): Promise<string> {
    const reference =
      existingReference ?? (await this.createPayoutEntry(businessId, amount, reason));
    try {
      const ref = await this.paystack.sendPayout(businessId, amount, reason, reference);
      await this.transactions.attachMetadata(reference, { payout_processor: 'paystack' });
      return ref;
    } catch (error: any) {
      const s = await this.settings();
      const canHop =
        !!s?.flutterwave_payouts_enabled &&
        this.flutterwave.isConfigured() &&
        this.paystackRefused(error);
      if (!canHop) throw error;
      this.logger.warn(
        `[NairaGateway] Paystack refused payout ${reference} (${error?.response?.data?.message || error?.message}) — sending via Flutterwave`,
      );
      return this.payoutViaFlutterwave(businessId, amount, reason, reference);
    }
  }

  private paystackRefused(error: any): boolean {
    const msg = String(error?.message ?? '');
    if (/otp/i.test(msg)) return false; // the transfer exists, awaiting an OTP
    if (error instanceof BadRequestException) return true;
    const status = error?.response?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
  }

  private async payoutViaFlutterwave(
    businessId: string,
    amount: number,
    reason: string | undefined,
    reference: string,
  ): Promise<string> {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Vendor not found');
    const accountNumber = (business as any).payout_account_number;
    if (!accountNumber) {
      throw new BadRequestException('Vendor has no payout bank account.');
    }
    const bankCode = await this.flutterwave.bankCodeFor(
      (business as any).payout_bank_code,
      (business as any).payout_bank_name,
    );
    const res = await this.flutterwave.transfer({
      reference,
      amount,
      bankCode,
      accountNumber,
      narration: reason || `Payout for ${business.business_name}`,
    });
    if (String(res.status).toUpperCase() === 'FAILED') {
      throw new BadRequestException('Payout could not be sent (status: failed).');
    }
    await this.transactions.attachMetadata(reference, {
      payout_processor: 'flutterwave',
      flutterwave_transfer_id: res.id,
    });
    return reference;
  }

  private async createPayoutEntry(businessId: string, amount: number, reason?: string) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Vendor not found');
    const tx = await this.transactions.create({
      initiator: businessId as unknown as Types.ObjectId,
      amount,
      type: TransactionType.DEBIT,
      status: TransactionStatus.PENDING,
      description: reason || `Payout for ${business.business_name}`,
      channel: 'payout',
      metadata: { payout_amount: amount, business_name: business.business_name },
    } as any);
    return tx.reference;
  }
}
