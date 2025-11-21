import { Processor, WorkerHost, OnQueueEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

import { Order, OrderDocument } from '../orders/schemas/orders.schema';
import {
  Business,
  BusinessDocument,
} from '../business/schemas/business.schema';
import { PaymentService } from '../payment/payment.service';

@Injectable()
@Processor('payout-queue')
export class PayoutProcessor extends WorkerHost {
  constructor(
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly paymentService: PaymentService,
  ) {
    super();
  }

  async process(job: Job) {
    const business = await this.businessModel.findById(job.data.businessId);
    if (!business) throw new Error('Business not found');

    const amount = business.pending_payout_balance || 0;
    if (amount <= 0) return { message: 'No pending payout' };

    // ✅ Ensure business has a transfer recipient
    if (!business.transfer_recipient_code) {
      throw new Error(
        `Business "${business.business_name}" does not have a transfer recipient. Cannot send payout.`,
      );
    }

    // ✅ Send payout
    const reference = await this.paymentService.sendPayout(
      business.id,
      amount,
      `Payout for ${business.business_name}`,
    );

    return {
      message: 'Business payout processed successfully',
      reference,
      amount,
    };
  }

  @OnQueueEvent('completed')
  onCompleted(job: Job, returnvalue: any) {
    console.log(`Payout job ${job.id} completed.`, returnvalue);
  }

  @OnQueueEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Payout job ${job.id} failed:`, error.message);
  }
}
