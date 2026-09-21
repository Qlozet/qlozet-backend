import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Pre-ship checkpoint + fit feedback — the two mechanisms that turn
 * "information delivered" into "garment fits": a bespoke order cannot ship
 * until the customer approves photos of the finished piece (or 72h pass),
 * and post-delivery fit outcomes aggregate onto the vendor's fit_stats.
 */
describe('pre-ship checkpoint & fit feedback', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let service: any;
  let notify: jest.Mock;
  let bizUpdate: jest.Mock;

  const customerId = new Types.ObjectId();
  const businessId = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    notify = jest.fn().mockResolvedValue({});
    bizUpdate = jest.fn().mockReturnValue({ catch: () => undefined });

    service = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      // Class-field initialisers don't run under Object.create — supply the
      // production step definitions buildProduction maps over.
      productionStepDefs: [
        { key: 'fabric_cut', label: 'Fabric cut', description: '' },
        { key: 'sewing', label: 'Sewing', description: '' },
        { key: 'finishing', label: 'Finishing', description: '' },
        { key: 'quality_check', label: 'Quality check', description: '' },
      ],
      orderModel,
      notificationsService: { create: notify },
      businessModel: {
        findById: () => ({
          select: () => ({ lean: async () => null }),
        }),
        updateOne: (...args: any[]) => {
          bizUpdate(...args);
          return Promise.resolve({});
        },
      },
    });
  });

  const allStepsDone = () =>
    ['fabric_cut', 'sewing', 'finishing', 'quality_check'].map((key) => ({
      key,
      completed: true,
      completed_at: new Date(),
    }));

  const makeBespoke = (overrides: Record<string, any> = {}) =>
    orderModel.create({
      customer: customerId,
      items: [],
      total: 90_000,
      subtotal: 90_000,
      type: 'bespoke',
      status: 'processing',
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
      shipments: [
        {
          business: businessId,
          shipment_type: 'vendor_to_customer',
          status: 'pending',
          production_steps: allStepsDone(),
        },
      ],
      ...overrides,
    });

  it('a bespoke order with all steps done still cannot ship without pre-ship photos', async () => {
    const order = await makeBespoke();
    await expect(
      service.markProductionReadyToShip(order.reference, businessId.toString()),
    ).rejects.toThrow(/pre-ship photos/i);
  });

  it('submit → customer approves → ship unblocks; both sides notified', async () => {
    const order = await makeBespoke();

    await service.submitPreship(order.reference, businessId.toString(), {
      photos: ['https://cdn/finished-1.jpg'],
      note: 'Finished agbada, front and back.',
    });
    expect(notify).toHaveBeenCalledTimes(1); // customer pinged

    // Still gated while the review is pending (window not elapsed).
    await expect(
      service.markProductionReadyToShip(order.reference, businessId.toString()),
    ).rejects.toThrow(/waiting for the customer/i);

    await service.reviewPreship(order.reference, customerId.toString(), {
      approve: true,
    });

    await service.markProductionReadyToShip(
      order.reference,
      businessId.toString(),
    );
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.preship.status).toBe('approved');
    expect(saved.shipments[0].ready_to_ship_at).toBeTruthy();
  });

  it('changes requested blocks shipping until the tailor resubmits', async () => {
    const order = await makeBespoke();
    await service.submitPreship(order.reference, businessId.toString(), {
      photos: ['https://cdn/finished-1.jpg'],
    });
    await service.reviewPreship(order.reference, customerId.toString(), {
      approve: false,
      note: 'The sleeves look longer than the design.',
    });

    await expect(
      service.markProductionReadyToShip(order.reference, businessId.toString()),
    ).rejects.toThrow(/requested changes/i);

    // Resubmission resets the review and re-notifies the customer.
    await service.submitPreship(order.reference, businessId.toString(), {
      photos: ['https://cdn/finished-2.jpg'],
    });
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.preship.status).toBe('pending_review');
  });

  it('72h of customer silence auto-clears the gate', async () => {
    const order = await makeBespoke();
    await service.submitPreship(order.reference, businessId.toString(), {
      photos: ['https://cdn/finished-1.jpg'],
    });
    // Backdate the submission past the approval window.
    await orderModel.updateOne(
      { _id: order._id },
      { 'preship.submitted_at': new Date(Date.now() - 73 * 3600_000) },
    );

    await service.markProductionReadyToShip(
      order.reference,
      businessId.toString(),
    );
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.shipments[0].ready_to_ship_at).toBeTruthy();
  });

  it('non-bespoke orders are untouched by the gate', async () => {
    const order = await makeBespoke({ type: 'standard' });
    await service.markProductionReadyToShip(
      order.reference,
      businessId.toString(),
    );
    const saved = await orderModel.findById(order._id).lean();
    expect(saved.shipments[0].ready_to_ship_at).toBeTruthy();
  });

  describe('fit feedback', () => {
    const delivered = () =>
      makeBespoke({
        status: 'completed',
        items: [{ business: businessId, product: new Types.ObjectId() }],
      });

    it('records once and aggregates onto the vendor fit_stats', async () => {
      const order = await delivered();
      await service.submitFitFeedback(order.reference, customerId.toString(), {
        fit: 'perfect',
        comment: 'Fits like a glove.',
      });

      const saved = await orderModel.findById(order._id).lean();
      expect(saved.fit_feedback.fit).toBe('perfect');
      expect(bizUpdate).toHaveBeenCalledWith(
        { _id: businessId.toString() },
        { $inc: { 'fit_stats.perfect': 1 } },
      );

      await expect(
        service.submitFitFeedback(order.reference, customerId.toString(), {
          fit: 'poor',
        }),
      ).rejects.toThrow(/already recorded/i);
    });

    it('only after delivery, only on bespoke, only valid values', async () => {
      const inTransit = await makeBespoke({ status: 'in_transit' });
      await expect(
        service.submitFitFeedback(inTransit.reference, customerId.toString(), {
          fit: 'perfect',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const delivered2 = await delivered();
      await expect(
        service.submitFitFeedback(delivered2.reference, customerId.toString(), {
          fit: 'excellent' as any,
        }),
      ).rejects.toThrow(/must be/i);
    });
  });
});
