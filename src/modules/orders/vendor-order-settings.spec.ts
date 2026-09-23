import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { ClothingType } from '../products/schemas/clothing.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * The two vendor order settings that actually do something: a daily order
 * cap (capacity, so vendors don't overcommit and deliver late) and
 * auto-confirmation (skips the manual confirm step for stock goods only).
 * Every other control on that settings page was removed as decoration.
 */
describe('vendor order settings enforcement', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let service: any;
  let businesses: any[];

  const tailorId = new Types.ObjectId();
  const fabricVendorId = new Types.ObjectId();
  const customerId = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    businesses = [];

    service = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      orderModel,
      // Minimal find().select().lean() chain over the in-test business list.
      businessModel: {
        find: (filter: any) => ({
          select: () => ({
            lean: async () =>
              businesses.filter((b) => {
                const ids: any[] = filter._id?.$in ?? [];
                if (!ids.some((id) => id.toString() === b._id.toString())) {
                  return false;
                }
                if (filter.order_confirmation !== undefined) {
                  return b.order_confirmation === filter.order_confirmation;
                }
                if (filter.daily_order_limit?.$gt !== undefined) {
                  return (b.daily_order_limit ?? 0) > filter.daily_order_limit.$gt;
                }
                return true;
              }),
          }),
        }),
      },
    });
  });

  const paidOrderToday = (businessId: Types.ObjectId) =>
    orderModel.create({
      customer: customerId,
      items: [{ business: businessId, product: new Types.ObjectId() }],
      total: 20_000,
      subtotal: 20_000,
      status: 'in_review',
      payment_status: 'paid',
      reference: `ORD-${Math.random().toString(36).slice(2, 8)}`,
    });

  describe('daily order limit', () => {
    const items = [{ business: tailorId, clothing_type: ClothingType.NON_CUSTOMIZE }];

    it('lets orders through while the vendor is under their cap', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', daily_order_limit: 2 },
      ];
      await paidOrderToday(tailorId);

      await expect(
        service.assertWithinDailyOrderLimits(items),
      ).resolves.toBeUndefined();
    });

    it('refuses the checkout once the cap is reached', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', daily_order_limit: 2 },
      ];
      await paidOrderToday(tailorId);
      await paidOrderToday(tailorId);

      await expect(service.assertWithinDailyOrderLimits(items)).rejects.toThrow(
        /Kemi Couture has reached their order limit for today/i,
      );
    });

    it('0 means unlimited', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', daily_order_limit: 0 },
      ];
      await paidOrderToday(tailorId);
      await paidOrderToday(tailorId);
      await paidOrderToday(tailorId);

      await expect(
        service.assertWithinDailyOrderLimits(items),
      ).resolves.toBeUndefined();
    });

    it('unpaid (abandoned) and cancelled orders never consume capacity', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', daily_order_limit: 1 },
      ];
      // An abandoned checkout…
      await orderModel.create({
        customer: customerId,
        items: [{ business: tailorId, product: new Types.ObjectId() }],
        total: 20_000,
        subtotal: 20_000,
        status: 'pending',
        payment_status: 'unpaid',
        reference: 'ORD-ABANDONED',
      });
      // …and a cancelled one.
      await orderModel.create({
        customer: customerId,
        items: [{ business: tailorId, product: new Types.ObjectId() }],
        total: 20_000,
        subtotal: 20_000,
        status: 'cancelled',
        payment_status: 'paid',
        reference: 'ORD-CANCELLED',
      });

      await expect(
        service.assertWithinDailyOrderLimits(items),
      ).resolves.toBeUndefined();
    });
  });

  describe('auto-confirmation', () => {
    it('pre-confirms stock goods with a fulfilment deadline', async () => {
      businesses = [{ _id: fabricVendorId, order_confirmation: true }];
      const shipments: any[] = [{ business: fabricVendorId, status: 'pending' }];

      await service.applyAutoConfirmation(shipments, [
        { business: fabricVendorId, clothing_type: ClothingType.NON_CUSTOMIZE },
      ]);

      expect(shipments[0].confirmed).toBe(true);
      expect(shipments[0].confirmed_at).toBeInstanceOf(Date);
      expect(shipments[0].fulfillment_deadline).toBeInstanceOf(Date);
    });

    it('never auto-confirms tailored work — that is the tailor’s decision', async () => {
      businesses = [{ _id: tailorId, order_confirmation: true }];
      const shipments: any[] = [{ business: tailorId, status: 'pending' }];

      await service.applyAutoConfirmation(shipments, [
        { business: tailorId, clothing_type: ClothingType.CUSTOMIZE },
      ]);

      expect(shipments[0].confirmed).toBeUndefined();
    });

    it('leaves vendors who did not opt in untouched', async () => {
      businesses = [{ _id: fabricVendorId, order_confirmation: false }];
      const shipments: any[] = [{ business: fabricVendorId, status: 'pending' }];

      await service.applyAutoConfirmation(shipments, [
        { business: fabricVendorId, clothing_type: ClothingType.NON_CUSTOMIZE },
      ]);

      expect(shipments[0].confirmed).toBeUndefined();
    });

    it('is per-vendor on a multi-vendor order', async () => {
      businesses = [
        { _id: fabricVendorId, order_confirmation: true },
        { _id: tailorId, order_confirmation: false },
      ];
      const shipments: any[] = [
        { business: fabricVendorId, status: 'pending' },
        { business: tailorId, status: 'pending' },
      ];

      await service.applyAutoConfirmation(shipments, [
        { business: fabricVendorId, clothing_type: ClothingType.NON_CUSTOMIZE },
        { business: tailorId, clothing_type: ClothingType.NON_CUSTOMIZE },
      ]);

      expect(shipments[0].confirmed).toBe(true);
      expect(shipments[1].confirmed).toBeUndefined();
    });
  });
});
