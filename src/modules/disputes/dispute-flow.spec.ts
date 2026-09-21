import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { DisputeSchema, DisputeStatus } from './schemas/dispute.schema';
import { DisputeResolution } from './dto/resolve-dispute.dto';
import { OrderSchema } from '../orders/schemas/orders.schema';
import { BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Dispute flow — the whole system leans on the payout hold as leverage:
 * filing freezes the vendor's unreleased earnings, and each resolution moves
 * the frozen money exactly once. Real models, stubbed money rails.
 */
describe('DisputesService', () => {
  const mongo = new MemoryMongo();
  let disputeModel: any;
  let orderModel: any;
  let earningsModel: any;
  let service: any;
  let creditWallet: jest.Mock;
  let findByOrderId: jest.Mock;

  const customerId = new Types.ObjectId();
  const businessId = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    disputeModel = mongo.model('Dispute', DisputeSchema);
    orderModel = mongo.model('Order', OrderSchema);
    earningsModel = mongo.model('BusinessEarning', BusinessEarningSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      disputeModel.deleteMany({}),
      orderModel.deleteMany({}),
      earningsModel.deleteMany({}),
    ]);
    creditWallet = jest.fn().mockResolvedValue(undefined);
    findByOrderId = jest.fn().mockResolvedValue({
      channel: 'wallet_checkout',
      wallet: new Types.ObjectId(),
      reference: 'TXN-1',
    });

    service = Object.create(DisputesService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      disputeModel,
      orderModel,
      businessEarningsModel: earningsModel,
      businessModel: { findById: jest.fn().mockResolvedValue(null) },
      notificationsService: {
        create: jest.fn().mockResolvedValue({}),
        notifyPlatformAdmins: jest.fn().mockResolvedValue(undefined),
      },
      transactionService: { findByOrderId, refundPaystackPayment: jest.fn() },
      walletsService: { creditWallet },
    });
  });

  const makeDeliveredOrder = () =>
    orderModel.create({
      customer: customerId,
      items: [],
      total: 60_000,
      subtotal: 60_000,
      status: 'completed',
      payment_status: 'paid',
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
    });

  const makeEarning = (order: any, over: Record<string, any> = {}) =>
    earningsModel.create({
      business: businessId,
      order: order._id,
      amount: 60_000,
      commission: 6_000,
      net_amount: 54_000,
      released: false,
      release_date: new Date(Date.now() + 86_400_000),
      ...over,
    });

  const fileDto = (order: any) => ({
    order_reference: order.reference,
    business_id: businessId.toString(),
    reason: 'damaged',
    description: 'The agbada arrived torn at the seam.',
  });

  describe('fileDispute', () => {
    it('freezes the vendor payout (release_date → null) and opens the case', async () => {
      const order = await makeDeliveredOrder();
      await makeEarning(order);

      // fileDispute returns the { message, data } envelope.
      const { data: dispute } = await service.fileDispute(
        customerId.toString(),
        fileDto(order),
      );

      expect(dispute.status).toBe(DisputeStatus.OPEN);
      const earning = await earningsModel.findOne({ order: order._id }).lean();
      expect(earning.release_date).toBeNull();
    });

    it('only delivered (completed) orders can be disputed', async () => {
      const order = await orderModel.create({
        customer: customerId,
        items: [],
        total: 60_000,
        subtotal: 60_000,
        status: 'in_transit',
        reference: 'QLZ-TRANSIT',
      });
      await expect(
        service.fileDispute(customerId.toString(), fileDto(order)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects once the vendor payout has already been released', async () => {
      const order = await makeDeliveredOrder();
      await makeEarning(order, { released: true });

      await expect(
        service.fileDispute(customerId.toString(), fileDto(order)),
      ).rejects.toThrow(/already been released/i);
    });

    it('one open dispute per vendor per order', async () => {
      const order = await makeDeliveredOrder();
      await makeEarning(order);
      await service.fileDispute(customerId.toString(), fileDto(order));

      await expect(
        service.fileDispute(customerId.toString(), fileDto(order)),
      ).rejects.toThrow(/already have an open dispute/i);
    });
  });

  describe('resolveDispute', () => {
    const adminId = new Types.ObjectId().toString();

    const openDispute = async () => {
      const order = await makeDeliveredOrder();
      await makeEarning(order);
      const { data: dispute } = await service.fileDispute(
        customerId.toString(),
        fileDto(order),
      );
      return { order, dispute };
    };

    it('full refund: deletes the frozen earnings and credits the customer', async () => {
      const { order, dispute } = await openDispute();

      await service.resolveDispute(dispute._id.toString(), adminId, {
        resolution: DisputeResolution.FULL_REFUND,
      });

      const saved = await disputeModel.findById(dispute._id).lean();
      expect(saved.status).toBe(DisputeStatus.RESOLVED_REFUND);
      expect(saved.refund_amount).toBe(54_000);
      expect(await earningsModel.countDocuments({ order: order._id })).toBe(0);
      expect(creditWallet).toHaveBeenCalledWith(expect.any(String), 54_000);
    });

    it('partial refund: reduces the earning, unfreezes the rest, refunds the amount', async () => {
      const { order, dispute } = await openDispute();

      await service.resolveDispute(dispute._id.toString(), adminId, {
        resolution: DisputeResolution.PARTIAL_REFUND,
        refund_amount: 14_000,
      });

      const earning = await earningsModel.findOne({ order: order._id }).lean();
      expect(earning.net_amount).toBe(40_000);
      expect(earning.release_date).not.toBeNull();
      expect(creditWallet).toHaveBeenCalledWith(expect.any(String), 14_000);
    });

    it('partial refund without an amount is rejected', async () => {
      const { dispute } = await openDispute();
      await expect(
        service.resolveDispute(dispute._id.toString(), adminId, {
          resolution: DisputeResolution.PARTIAL_REFUND,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('release to vendor: unfreezes the payout, no money to the customer', async () => {
      const { order, dispute } = await openDispute();

      await service.resolveDispute(dispute._id.toString(), adminId, {
        resolution: DisputeResolution.RELEASE_TO_VENDOR,
      });

      const earning = await earningsModel.findOne({ order: order._id }).lean();
      expect(earning.release_date).not.toBeNull();
      expect(earning.net_amount).toBe(54_000);
      expect(creditWallet).not.toHaveBeenCalled();
    });

    it('a resolved dispute cannot be resolved twice', async () => {
      const { dispute } = await openDispute();
      await service.resolveDispute(dispute._id.toString(), adminId, {
        resolution: DisputeResolution.RELEASE_TO_VENDOR,
      });

      await expect(
        service.resolveDispute(dispute._id.toString(), adminId, {
          resolution: DisputeResolution.FULL_REFUND,
        }),
      ).rejects.toThrow(/already been resolved/i);
      expect(creditWallet).not.toHaveBeenCalled();
    });
  });
});
