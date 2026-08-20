import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
  BadGatewayException,
  HttpException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateTransferRecipientDto,
  VerifyBankAccountDto,
} from './dto/payment.dto';
import {
  BusinessDocument,
  Business,
} from '../business/schemas/business.schema';
import { TransactionService } from '../transactions/transactions.service';
import {
  TransactionStatus,
  TransactionType,
} from '../transactions/schema/transaction.schema';
import { PlatformService } from '../platform/platform.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly transactionService: TransactionService,
    private readonly platformService: PlatformService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  private getPaystackHeaders() {
    const PAYSTACK_SECRET = this.configService.get<string>(
      'PAYSTACK_SECRET_KEY',
    );
    return { Authorization: `Bearer ${PAYSTACK_SECRET}` };
  }

  async initializePaystackPayment(txReference: string, email: string) {
    try {
      const transaction =
        await this.transactionService.findByReference(txReference);

      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }

      const PAYSTACK_SECRET = this.configService.get<string>(
        'PAYSTACK_SECRET_KEY',
      );
      const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');

      if (!PAYSTACK_SECRET) {
        throw new InternalServerErrorException(
          'Paystack secret key not configured',
        );
      }

      const payload: Record<string, any> = {
        email,
        // Kobo, integer — Math.round guards against float artefacts on
        // fractional naira amounts (Paystack rejects non-integer amounts).
        amount: Math.round(transaction.amount * 100),
        reference: transaction.reference,
        currency: transaction.currency || 'NGN',
      };
      // Only send a callback_url when FRONTEND_URL is configured — otherwise it
      // becomes "undefined/payment/verify", which Paystack rejects as an invalid
      // URL (a 400 that surfaced here as a generic 502). With it omitted,
      // Paystack falls back to the dashboard-configured callback.
      if (FRONTEND_URL) {
        payload.callback_url = `${FRONTEND_URL}/payment/verify`;
      } else {
        this.logger?.warn(
          'FRONTEND_URL not set — initializing Paystack without a callback_url',
        );
      }

      const response: any = await firstValueFrom(
        this.httpService.post(
          'https://api.paystack.co/transaction/initialize',
          payload,
          {
            headers: {
              Authorization: `Bearer ${PAYSTACK_SECRET}`,
            },
          },
        ),
      );

      const { authorization_url, reference, access_code } =
        response?.data?.data || {};

      if (!authorization_url || !reference || !access_code) {
        throw new BadGatewayException(
          'Invalid response received from Paystack',
        );
      }

      transaction.metadata = {
        ...transaction.metadata,
        paystack: {
          authorization_url,
          access_code,
          reference,
          initialized_at: new Date().toISOString(),
        },
      };

      await transaction.save();

      return {
        success: true,
        message: 'Payment initialized successfully',
        data: {
          paymentUrl: authorization_url,
          reference,
          access_code,
          amount: transaction.amount,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Surface Paystack's actual reason instead of a blanket message — an
      // opaque 502 makes "invalid key" / "invalid callback" impossible to
      // diagnose from the client. Paystack error bodies are safe to relay.
      const paystackMessage: string | undefined = error?.response?.data?.message;
      this.logger?.error(
        `Paystack payment initialization failed: ${paystackMessage || error?.message}`,
        error?.response?.data || error.stack || error,
      );

      throw new BadGatewayException(
        paystackMessage
          ? `Unable to initialize payment: ${paystackMessage}`
          : 'Unable to initialize payment at this time. Please try again.',
      );
    }
  }

  async verifyPaystackPayment(reference: string) {
    const PAYSTACK_SECRET = this.configService.get<string>(
      'PAYSTACK_SECRET_KEY',
    );
    const verifyUrl = `https://api.paystack.co/transaction/verify/${reference}`;

    const response: any = await firstValueFrom(
      this.httpService.get(verifyUrl, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      }),
    );

    const data = response.data.data;
    const transaction =
      await this.transactionService.findByReference(reference);

    if (!transaction) throw new NotFoundException('Transaction not found');

    // Guard: don't re-process already completed transactions
    if (transaction.status === TransactionStatus.SUCCESS) {
      return {
        success: true,
        status: transaction.status,
        reference,
        amount: transaction.amount,
        walletId: transaction.wallet?.toString() || null,
        transactionType: transaction.type,
        alreadyProcessed: true,
        message: 'Payment verified successfully',
      };
    }

    if (data.status === 'success') {
      // Atomic update to prevent race conditions during rapid requests
      const updated = await (this.transactionService as any).transactionModel.findOneAndUpdate(
        { _id: transaction._id, status: { $ne: TransactionStatus.SUCCESS } },
        { 
          $set: { 
            status: TransactionStatus.SUCCESS, 
            'metadata.paystack': data 
          } 
        },
        { new: true }
      );

      if (!updated) {
        return {
          success: true,
          status: TransactionStatus.SUCCESS,
          reference,
          amount: transaction.amount,
          walletId: transaction.wallet?.toString() || null,
          transactionType: transaction.type,
          alreadyProcessed: true,
          message: 'Payment verified successfully',
        };
      }
      
      transaction.status = TransactionStatus.SUCCESS;
    } else {
      transaction.status = TransactionStatus.FAILED;
      await transaction.save();
    }

    return {
      success: true,
      status: transaction.status,
      reference,
      amount: transaction.amount,
      walletId: transaction.wallet?.toString() || null,
      transactionType: transaction.type,
      alreadyProcessed: false,
      message:
        transaction.status === TransactionStatus.SUCCESS
          ? 'Payment verified successfully'
          : 'Payment failed or incomplete',
    };
  }
  /** ---------------- Verify Bank Account ---------------- */
  async verifyBankAccount(dto: VerifyBankAccountDto): Promise<boolean> {
    const url = `https://api.paystack.co/bank/resolve?account_number=${dto.account_number}&bank_code=${dto.bank_code}`;
    const response: any = await firstValueFrom(
      this.httpService.get(url, { headers: this.getPaystackHeaders() }),
    );

    if (!response.data || !response.data.status || !response.data.data) {
      throw new BadRequestException('Bank account verification failed');
    }

    return response.data.status === true;
  }

  async createTransferRecipient(
    businessId: string,
    dto: CreateTransferRecipientDto,
  ) {
    // Check vendor exists
    const vendor = await this.businessModel.findById(businessId);
    if (!vendor) throw new NotFoundException('Vendor not found');

    // Verify the account first
    const isValid = await this.verifyBankAccount({
      account_number: dto.account_number,
      bank_code: dto.bank_code,
    });
    if (!isValid)
      throw new BadRequestException('Bank account verification failed');

    // Create recipient
    const url = `https://api.paystack.co/transferrecipient`;
    const payload = {
      type: dto.type || 'nuban',
      name: dto.name,
      account_number: dto.account_number,
      bank_code: dto.bank_code,
      currency: dto.currency || 'NGN',
    };

    const response: any = await firstValueFrom(
      this.httpService.post(url, payload, {
        headers: this.getPaystackHeaders(),
      }),
    );

    if (!response.data.status || !response.data.data) {
      throw new BadRequestException('Failed to create transfer recipient');
    }

    const recipient = response.data.data;
    const details = recipient.details || {};

    // Save the recipient code (used for payouts) + the display details so the
    // vendor's Settings → Payout screen can show what's linked.
    vendor.transfer_recipient_code = recipient.recipient_code;
    vendor.payout_bank_name = details.bank_name ?? dto.bank_name ?? null;
    vendor.payout_bank_code = details.bank_code ?? dto.bank_code;
    vendor.payout_account_number =
      details.account_number ?? dto.account_number;
    vendor.payout_account_name = details.account_name ?? dto.name;
    await vendor.save();

    return {
      message: 'Payout account linked successfully',
      recipient_code: recipient.recipient_code,
      account: this.formatPayoutAccount(vendor),
    };
  }

  /** ---------------- List supported banks ---------------- */
  async listBanks(currency = 'NGN') {
    const url = `https://api.paystack.co/bank?currency=${currency}`;
    const response: any = await firstValueFrom(
      this.httpService.get(url, { headers: this.getPaystackHeaders() }),
    );

    if (!response.data?.status || !Array.isArray(response.data.data)) {
      throw new BadGatewayException('Unable to fetch bank list');
    }

    // Trim to what the client needs to render a picker.
    return response.data.data.map((b: any) => ({
      name: b.name,
      code: b.code,
      slug: b.slug,
    }));
  }

  /**
   * Resolve an account number against a bank to confirm the name before the
   * vendor links it. Returns the resolved account name for confirmation.
   */
  async resolveBankAccount(dto: VerifyBankAccountDto) {
    const url = `https://api.paystack.co/bank/resolve?account_number=${dto.account_number}&bank_code=${dto.bank_code}`;
    let response: any;
    try {
      response = await firstValueFrom(
        this.httpService.get(url, { headers: this.getPaystackHeaders() }),
      );
    } catch {
      // Paystack returns 4xx for an unresolvable account — surface a clean 400.
      throw new BadRequestException(
        'Could not verify that account number for the selected bank.',
      );
    }

    if (!response.data?.status || !response.data.data?.account_name) {
      throw new BadRequestException(
        'Could not verify that account number for the selected bank.',
      );
    }

    return {
      account_number: response.data.data.account_number,
      account_name: response.data.data.account_name,
      bank_code: dto.bank_code,
    };
  }

  /** Current linked payout account (masked) for the Settings screen. */
  async getPayoutAccount(businessId: string) {
    const vendor = await this.businessModel.findById(businessId);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.formatPayoutAccount(vendor);
  }

  /** Shapes the stored payout details for the client, masking the account no. */
  private formatPayoutAccount(vendor: BusinessDocument) {
    const linked = !!vendor.transfer_recipient_code;
    const accountNumber = vendor.payout_account_number || '';
    return {
      linked,
      bank_name: vendor.payout_bank_name || null,
      bank_code: vendor.payout_bank_code || null,
      account_name: vendor.payout_account_name || null,
      account_number: accountNumber
        ? `******${accountNumber.slice(-4)}`
        : null,
    };
  }

  /** ---------------- Send Payout ---------------- */
  async sendPayout(businessId: string, amount: number, reason?: string) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Vendor not found');

    if (!business.transfer_recipient_code) {
      throw new BadRequestException(
        'Vendor does not have a transfer recipient',
      );
    }

    // Amount is already post-commission (net_amount from BusinessEarning).
    // Do NOT call platformService.compute() here — commission was already
    // deducted when recording earnings. Transferring the exact amount.
    const transaction = await this.transactionService.create({
      initiator: businessId as unknown as Types.ObjectId,
      amount,
      type: TransactionType.CREDIT,
      description: reason || `Payout for ${business.business_name}`,
      channel: 'payout',
      metadata: {
        payout_amount: amount,
        business_name: business.business_name,
      },
    });

    const payload = {
      source: 'balance',
      amount: Math.round(amount * 100), // Paystack uses kobo (integer)
      recipient: business.transfer_recipient_code,
      reason: reason || `Payout for ${business.business_name}`,
      reference: transaction.reference,
    };

    const url = `https://api.paystack.co/transfer`;
    const response: any = await firstValueFrom(
      this.httpService.post(url, payload, {
        headers: this.getPaystackHeaders(),
      }),
    );

    if (!response.data.status || !response.data.data) {
      throw new BadRequestException('Failed to send payout');
    }
    return response.data.data.reference;
  }

}
