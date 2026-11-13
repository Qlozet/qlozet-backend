import { Types } from 'mongoose';
import { OrderService } from '../orders/orders.service';
import { ProductService } from '../products/products.service';
import { WebhookService } from '../webhook/webhook.service';

/**
 * Pilot QA review, staging checklist BUG-07 (fabric from another shop left
 * paid for when the tailor's garment is cancelled) and BUG-10 (a card buyer
 * paying for the last unit after someone else took it).
 */

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const tailor = new Types.ObjectId().toString();
const fabricShop = new Types.ObjectId().toString();
const fabricProduct = new Types.ObjectId();

/** A bespoke order: tailor's deposit line + another shop's fabric line and its transfer. */
const bespokeOrder = (legStatus = 'pending') => {
  const tailorItem: any = {
    _id: new Types.ObjectId(),
    business: new Types.ObjectId(tailor),
    total_price: 45_000,
    applied_fabric: fabricProduct,
  };
  const fabricItem: any = {
    _id: new Types.ObjectId(),
    business: new Types.ObjectId(fabricShop),
    product: fabricProduct,
    total_price: 20_000,
  };
  return {
    tailorItem,
    fabricItem,
    order: {
      _id: new Types.ObjectId(),
      reference: 'BSP-1',
      type: 'bespoke',
      customer: new Types.ObjectId(),
      status: 'processing',
      subtotal: 65_000,
      shipping_fee: 0,
      total: 65_000,
      items: [tailorItem, fabricItem],
      shipments: [
        { business: new Types.ObjectId(tailor), shipment_type: 'vendor_to_customer', confirmed: true, shipping_fee: 0 },
        {
          business: new Types.ObjectId(fabricShop),
          destination_business: new Types.ObjectId(tailor),
          fabric_product: fabricProduct,
          shipment_type: 'fabric_transfer',
          status: legStatus,
          confirmed: true,
          shipping_fee: 1_500,
        },
      ],
      markModified: () => undefined,
      save: jest.fn(),
    } as any,
  };
};

const orderService = () => {
  const service: any = Object.create(OrderService.prototype);
  const processPartialRefund = jest.fn().mockResolvedValue({ success: true });
  const reverseBusinessEarnings = jest.fn().mockResolvedValue(undefined);
  const restoreInventory = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    logger: quiet,
    processPartialRefund,
    reverseBusinessEarnings,
    productService: { restoreInventory },
  });
  return { service, processPartialRefund, reverseBusinessEarnings, restoreInventory };
};

describe("BUG-07: the other shop's fabric is refunded when the garment is cancelled", () => {
  it('tailor rejects a bespoke piece: deposit, fabric and its shipping refunded, fabric shop reversed', async () => {
    const { order, fabricItem, tailorItem } = bespokeOrder();
    const { service, processPartialRefund, reverseBusinessEarnings, restoreInventory } = orderService();

    const { refundAmount, orderCancelled } = await service._rejectItems(
      order,
      tailor,
      [tailorItem],
      'Cannot make this',
    );

    expect(refundAmount).toBe(45_000 + 20_000 + 1_500);
    expect(processPartialRefund).toHaveBeenCalledWith(order, 66_500, 'Cannot make this');
    expect(fabricItem.rejected).toBe(true);
    expect(order.shipments[1].rejected).toBe(true);
    expect(orderCancelled).toBe(true);
    expect(order.total).toBe(0);
    expect(reverseBusinessEarnings).toHaveBeenCalledWith(order, fabricShop, String(fabricItem._id));
    // The fabric never left the shop, so it goes back on sale.
    expect(restoreInventory).toHaveBeenCalledWith(order._id, fabricShop, String(fabricItem._id));
  });

  it('fabric already delivered to the tailor is refunded but not put back in stock', async () => {
    const { order, fabricItem, tailorItem } = bespokeOrder('delivered');
    const { service, restoreInventory } = orderService();
    await service._rejectItems(order, tailor, [tailorItem], 'Cannot make this');
    expect(fabricItem.rejected).toBe(true);
    expect(order.shipments[1].status).toBe('delivered');
    expect(restoreInventory).not.toHaveBeenCalledWith(order._id, fabricShop, String(fabricItem._id));
  });

  it("on a normal order, a fabric the customer bought for themselves is left alone", async () => {
    const { order, fabricItem, tailorItem } = bespokeOrder();
    order.type = 'standard';
    tailorItem.pricing = { external_fabric: 8_000 };
    const { service } = orderService();
    const { refundAmount } = await service._rejectItems(order, tailor, [tailorItem], 'No');
    // Garment + its applied fabric + the transfer's shipping; the customer's
    // own fabric line is not cancelled.
    expect(refundAmount).toBe(45_000 + 8_000 + 1_500);
    expect(fabricItem.rejected).toBeUndefined();
  });

  it('a tailor abandoning the piece refunds the fabric too', async () => {
    // The fabric arrived long ago, so the lateness is the tailor's own.
    const { order, fabricItem } = bespokeOrder('delivered');
    order.shipments[1].delivered_at = new Date(Date.now() - 40 * 86_400_000);
    order.shipments[0].fulfillment_deadline = new Date(Date.now() - 30 * 86_400_000);
    order.shipments[0].status = 'pending';
    order.shipments[0]._id = new Types.ObjectId();
    const { service, processPartialRefund, reverseBusinessEarnings } = orderService();
    const reconcileBusinessWallet = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, {
      platformSettingsModel: { findOne: () => ({ lean: async () => ({ abandon_after_days: 7 }) }) },
      orderModel: {
        find: async () => [order],
        updateOne: async () => ({ modifiedCount: 1 }),
      },
      businessModel: { findById: async () => ({ business_name: 'Tailor' }) },
      notificationsService: { create: jest.fn().mockResolvedValue({}) },
      vendorRecipients: { resolve: async () => [] },
      walletsService: { reconcileBusinessWallet },
    });

    await service.cancelAbandonedShipments();

    // The customer is refunded in full, fabric included...
    expect(processPartialRefund.mock.calls[0][1]).toBe(45_000 + 20_000 + 1_500);
    expect(fabricItem.rejected).toBe(true);
    expect(order.status).toBe('cancelled');
    // ...but the fabric already went out, and the tailor is at fault: the
    // fabric shop keeps its payment and the tailor bears it (13 Nov 2026).
    expect(reverseBusinessEarnings).not.toHaveBeenCalledWith(order, fabricShop, String(fabricItem._id));
    expect(reconcileBusinessWallet).toHaveBeenCalledWith(
      tailor,
      { balance: -20_000 },
      expect.objectContaining({ metadata: { reason: 'fabric_on_tailor' } }),
    );
  });
});

describe('BUG-10: a line that sold out while the customer paid is refunded', () => {
  it('finds exactly the lines stock can no longer cover, changing nothing', async () => {
    const service: any = Object.create(ProductService.prototype);
    const lines = [
      { _id: new Types.ObjectId(), product: new Types.ObjectId() },
      { _id: new Types.ObjectId(), product: new Types.ObjectId() },
      { _id: new Types.ObjectId(), rejected: true },
    ];
    const abort = jest.fn().mockResolvedValue(undefined);
    let live = false;
    service.orderModel = { findById: async () => ({ items: lines }) };
    service.connection = {
      startSession: async () => ({
        startTransaction: () => {
          live = true;
        },
        inTransaction: () => live,
        abortTransaction: async () => {
          live = false;
          await abort();
        },
        endSession: async () => undefined,
      }),
    };
    service.updateFabric = jest.fn();
    service.updateAccessory = jest.fn();
    service.updateColorVariant = jest.fn(async (item: any) => {
      if (item === lines[1]) throw new Error('Only 0 left');
    });

    const short = await service.findItemsShortOfStock(new Types.ObjectId());
    expect(short).toEqual([String(lines[1]._id)]);
    // Every rehearsal is rolled back; the already-rejected line is not tried.
    expect(abort).toHaveBeenCalledTimes(2);
  });

  it('stock deduction skips a refunded line', async () => {
    const service: any = Object.create(ProductService.prototype);
    const kept = { _id: 1, product: 'a' };
    const refunded = { _id: 2, product: 'b', rejected: true };
    const order: any = { items: [kept, refunded], save: jest.fn() };
    service.logger = quiet;
    service.orderModel = { findById: () => ({ session: async () => order }) };
    service.connection = {
      startSession: async () => ({
        withTransaction: async (fn: () => Promise<void>) => fn(),
        endSession: async () => undefined,
      }),
    };
    service.updateFabric = jest.fn();
    service.updateAccessory = jest.fn();
    service.updateColorVariant = jest.fn();
    service.notifyLowStock = jest.fn();

    await service.updateInventory(new Types.ObjectId());
    expect(service.updateColorVariant).toHaveBeenCalledTimes(1);
    expect(service.updateColorVariant.mock.calls[0][0]).toBe(kept);
    expect(order.inventory_deducted).toBe(true);
  });

  it('refunds each store\'s sold-out lines once, through the normal rejection path', async () => {
    const storeA = new Types.ObjectId().toString();
    const storeB = new Types.ObjectId().toString();
    const a1 = { _id: new Types.ObjectId(), business: new Types.ObjectId(storeA) };
    const a2 = { _id: new Types.ObjectId(), business: new Types.ObjectId(storeA) };
    const b1 = { _id: new Types.ObjectId(), business: new Types.ObjectId(storeB) };
    const order: any = { _id: new Types.ObjectId(), reference: 'ORD-5', customer: new Types.ObjectId(), items: [a1, a2, b1] };
    const service: any = Object.create(OrderService.prototype);
    const rejectItems = jest.fn().mockResolvedValue({ refundAmount: 9_000, orderCancelled: false });
    const notify = jest.fn().mockResolvedValue({});
    let claimed = false;
    Object.assign(service, {
      logger: quiet,
      _rejectItems: rejectItems,
      notificationsService: { create: notify },
      orderModel: {
        updateOne: async () => {
          const first = !claimed;
          claimed = true;
          return { modifiedCount: first ? 1 : 0 };
        },
        findById: async () => order,
      },
    });

    const refunded = await service.refundSoldOutItems(order._id, [String(a1._id), String(b1._id)]);
    expect(refunded).toBe(18_000);
    expect(rejectItems).toHaveBeenCalledTimes(2);
    expect(rejectItems).toHaveBeenCalledWith(order, storeA, [a1], expect.any(String));
    expect(rejectItems).toHaveBeenCalledWith(order, storeB, [b1], expect.any(String));
    expect(notify).toHaveBeenCalledTimes(1);

    // The webhook and the verify page racing: the second does nothing.
    expect(await service.refundSoldOutItems(order._id, [String(a1._id)])).toBeNull();
    expect(rejectItems).toHaveBeenCalledTimes(2);
  });

  it('after payment: refund the sold-out line, take the rest from stock, clear the flag', async () => {
    const service: any = Object.create(WebhookService.prototype);
    const updateInventory = jest.fn().mockResolvedValue(undefined);
    const orderUpdate = jest.fn().mockResolvedValue({});
    Object.assign(service, {
      productService: { findItemsShortOfStock: async () => ['line-2'], updateInventory },
      orderService: { refundSoldOutItems: jest.fn().mockResolvedValue(12_000) },
      orderModel: { updateOne: orderUpdate },
    });
    await service.settleSoldOutLines('order-1');
    expect(service.orderService.refundSoldOutItems).toHaveBeenCalledWith('order-1', ['line-2']);
    expect(updateInventory).toHaveBeenCalledWith('order-1');
    expect(orderUpdate).toHaveBeenCalledWith(
      { _id: 'order-1' },
      { $set: { inventory_deduction_failed: false } },
    );
  });

  it('a stock failure that is not a sell-out stays flagged for a person', async () => {
    const service: any = Object.create(WebhookService.prototype);
    const refundSoldOutItems = jest.fn();
    Object.assign(service, {
      productService: { findItemsShortOfStock: async () => [], updateInventory: jest.fn() },
      orderService: { refundSoldOutItems },
      orderModel: { updateOne: jest.fn() },
    });
    await service.settleSoldOutLines('order-1');
    expect(refundSoldOutItems).not.toHaveBeenCalled();
    expect(service.orderModel.updateOne).not.toHaveBeenCalled();
  });
});
