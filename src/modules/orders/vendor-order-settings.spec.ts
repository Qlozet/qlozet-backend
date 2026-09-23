import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderSchema } from './schemas/orders.schema';
import { ClothingType } from '../products/schemas/clothing.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * The two vendor order settings that actually do something: an order-capacity
 * cap (work in flight, so vendors don't overcommit and deliver late) and
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
                if (filter.max_open_orders?.$gt !== undefined) {
                  return (b.max_open_orders ?? 0) > filter.max_open_orders.$gt;
                }
                return true;
              }),
          }),
        }),
      },
    });
  });

  /** A paid order sitting on the vendor's bench (holds a capacity slot). */
  const openOrder = (businessId: Types.ObjectId, status = 'in_review') =>
    orderModel.create({
      customer: customerId,
      items: [{ business: businessId, product: new Types.ObjectId() }],
      total: 20_000,
      subtotal: 20_000,
      status,
      payment_status: 'paid',
      reference: `ORD-${Math.random().toString(36).slice(2, 8)}`,
    });

  describe('order capacity (work in flight)', () => {
    const items = [
      { business: tailorId, clothing_type: ClothingType.NON_CUSTOMIZE },
    ];

    it('is clear while the vendor is under their cap', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 2 },
      ];
      await openOrder(tailorId);

      await expect(service.findVendorsAtCapacity(items)).resolves.toEqual([]);
    });

    it('reports the vendor once their bench is full', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 2 },
      ];
      await openOrder(tailorId);
      await openOrder(tailorId);

      await expect(service.findVendorsAtCapacity(items)).resolves.toEqual([
        { businessId: tailorId.toString(), businessName: 'Kemi Couture' },
      ]);
      // createOrder's backstop turns that into a refusal naming the vendor.
      await expect(service.assertWithinOrderCapacity(items)).rejects.toThrow(
        /Kemi Couture is fully booked/i,
      );
    });

    it('0 means unlimited', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 0 },
      ];
      await openOrder(tailorId);
      await openOrder(tailorId);
      await openOrder(tailorId);

      await expect(service.findVendorsAtCapacity(items)).resolves.toEqual([]);
    });

    it('counts work in flight, not arrivals — an old open order still holds a slot', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
      ];
      const stale = await openOrder(tailorId, 'processing');
      // Backdate it well past "today": an arrivals-per-day cap would free this
      // slot every midnight while the garment is still on the bench.
      await orderModel.updateOne(
        { _id: stale._id },
        { createdAt: new Date(Date.now() - 30 * 86400000) },
        { timestamps: false },
      );

      await expect(service.findVendorsAtCapacity(items)).resolves.toHaveLength(1);
    });

    it('finishing or cancelling an order frees the slot; unpaid never took one', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
      ];
      await openOrder(tailorId, 'completed');
      await openOrder(tailorId, 'cancelled');
      await orderModel.create({
        customer: customerId,
        items: [{ business: tailorId, product: new Types.ObjectId() }],
        total: 20_000,
        subtotal: 20_000,
        status: 'pending',
        payment_status: 'unpaid',
        reference: 'ORD-ABANDONED',
      });

      await expect(service.findVendorsAtCapacity(items)).resolves.toEqual([]);
    });

    it('shipping frees the slot — the piece is off the bench', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
      ];
      await openOrder(tailorId, 'in_transit');

      await expect(service.findVendorsAtCapacity(items)).resolves.toEqual([]);
    });

    it('a returned order does not hold a slot forever', async () => {
      // `returned` never becomes `completed`, so counting it would leave the
      // vendor permanently "fully booked" after enough returns.
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
      ];
      await openOrder(tailorId, 'returned');

      await expect(service.findVendorsAtCapacity(items)).resolves.toEqual([]);
    });

    it('a paid order stuck at pending still counts (split finalisation write)', async () => {
      // finalizeCheckoutOrder records payment and flips status separately; a
      // crash between them leaves real, workable work the vendor can see.
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
      ];
      await openOrder(tailorId, 'pending');

      await expect(service.findVendorsAtCapacity(items)).resolves.toHaveLength(1);
    });

    it('bespoke orders occupy the bench like any other work', async () => {
      // Quote acceptance creates the order straight from the bespoke service
      // (status `processing` on payment), so it counts here even though it
      // never passes through cart checkout.
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
      ];
      await orderModel.create({
        customer: customerId,
        items: [{ business: tailorId, product: new Types.ObjectId() }],
        total: 90_000,
        subtotal: 90_000,
        type: 'bespoke',
        status: 'processing',
        payment_status: 'paid',
        reference: 'ORD-BESPOKE',
      });

      await expect(service.findVendorsAtCapacity(items)).resolves.toHaveLength(1);
    });

    it('only names the vendors that are actually full on a multi-vendor cart', async () => {
      businesses = [
        { _id: tailorId, business_name: 'Kemi Couture', max_open_orders: 1 },
        { _id: fabricVendorId, business_name: 'Lagos Fabrics', max_open_orders: 5 },
      ];
      await openOrder(tailorId);
      await openOrder(fabricVendorId);

      const blocked = await service.findVendorsAtCapacity([
        { business: tailorId },
        { business: fabricVendorId },
      ]);
      expect(blocked).toEqual([
        { businessId: tailorId.toString(), businessName: 'Kemi Couture' },
      ]);
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
