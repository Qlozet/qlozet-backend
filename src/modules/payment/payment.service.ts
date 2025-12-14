~~~{
  variant: 'standard',
  title: 'Payment Service for Vendor Payouts',
  id: '27504',
};
import {
  Injectable,
  BadRequestException,
  NotFoundException,
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
    console.log(txReference);
    const transaction =
      await this.transactionService.findByReference(txReference);
    if (!transaction) throw new NotFoundException('Transaction not found');

    const PAYSTACK_SECRET = this.configService.get<string>(
      'PAYSTACK_SECRET_KEY',
    );
    const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');

    const payload = {
      email,
      amount: transaction.amount * 100, // Paystack uses kobo
      reference: transaction.reference,
      currency: transaction.currency,
      callback_url: `${FRONTEND_URL}/payment/verify`,
    };

    const response: any = await firstValueFrom(
      this.httpService.post(
        'https://api.paystack.co/transaction/initialize',
        payload,
        {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        },
      ),
    );

    const { authorization_url, reference, access_code } = response.data.data;

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

    if (data.status === 'success') {
      transaction.status = TransactionStatus.SUCCESS;
      transaction.metadata = { ...transaction.metadata, paystack: data };
      await transaction.save();
    } else {
      transaction.status = TransactionStatus.FAILED;
      await transaction.save();
    }

    return {
      success: true,
      status: transaction.status,
      reference,
      amount: transaction.amount,
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

    // Save recipient code to vendor for future payouts
    vendor.transfer_recipient_code = response.data.data.recipient_code;
    await vendor.save();

    return {
      message: 'Recipient created successfully',
      recipient_code: response.data.data.recipient_code,
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
    const { vendorEarnings, commission, tax } =
      await this.platformService.compute(amount);
    const transaction = await this.transactionService.create({
      initiator: businessId as unknown as Types.ObjectId, // vendor as initiator
      amount: vendorEarnings,
      type: TransactionType.CREDIT,
      description: reason || `Payout for ${business.business_name}`,
      channel: 'payout',
      metadata: {
        totalAmount: amount,
        commission,
        tax,
        vendorEarnings,
      },
    });

    const payload = {
      source: 'balance',
      amount: amount * 100, // Paystack uses kobo
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
