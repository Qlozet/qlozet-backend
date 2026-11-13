import { Types } from 'mongoose';
import { OrderService } from '../orders/orders.service';

/**
 * Who pays for fabric from another shop once it has gone out to the tailor
 * (bespoke review, 13 Nov 2026):
 * - the customer cancels: it is not refunded, and the fabric shop keeps its
 *   payment (it was bought for them and may already be cut);
 * - the tailor walks away: the customer is refunded in full, the fabric shop
 *   keeps its payment, and the tailor bears the cost from their balance.
 */

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const tailor = new Types.ObjectId().toString();
const fabricShop = new Types.ObjectId().toString();
const fabricProduct = new Types.ObjectId();

const bespokeOrder = (legStatus: string) => {
  const tailorItem: any = { _id: new Types.ObjectId(), business: new Types.ObjectId(tailor), total_price: 50_000 };
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
      reference: 'BSP-7',
      type: 'bespoke',
      customer: new Types.ObjectId(),
      status: 'processing',
      subtotal: 70_000,
      shipping_fee: 0,
      total: 70_000,
      payment_plan: {
        kind: 'deposit',
        tailor,
        quote_total: 100_000,
        deposit_amount: 50_000,
        status: 'deposit_paid',
      },
      items: [tailorItem, fabricItem],
      shipments: [
        { business: new Types.ObjectId(tailor), shipment_type: 'vendor_to_customer', confirmed: true, status: 'pending', shipping_fee: 0 },
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

const service = () => {
  const svc: any = Object.create(OrderService.prototype);
  const reconcileBusinessWallet = jest.fn().mockResolvedValue(undefined);
  const reverseBusinessEarnings = jest.fn().mockResolvedValue(undefined);
  const processPartialRefund = jest.fn().mockResolvedValue({ success: true });
  const create = jest.fn().mockResolvedValue({});
  Object.assign(svc, {
    logger: quiet,
    platformSettingsModel: { findOne: () => ({ lean: async () => ({ custom_cancellation_fee_percent: 30 }) }) },
    productModel: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    walletsService: { reconcileBusinessWallet },
    reverseBusinessEarnings,
    processPartialRefund,
    productService: { restoreInventory: jest.fn().mockResolvedValue(undefined) },
    notificationsService: { create },
    vendorRecipients: { resolve: async () => [{ userId: 'owner' }] },
  });
  return { svc, reconcileBusinessWallet, reverseBusinessEarnings, processPartialRefund, create };
};

describe('customer cancels a bespoke order', () => {
  it('fabric already sent is kept for the fabric shop, on top of the tailor’s share', async () => {
    const { order, fabricItem } = bespokeOrder('delivered');
    const { svc } = service();
    const quote = await svc.quoteCancellation(order, 70_000);
    const fabric = quote.lines.find((l: any) => l.kind === 'fabric');
    expect(fabric).toMatchObject({ item: String(fabricItem._id), business: fabricShop, amount: 20_000 });
    const work = quote.lines.find((l: any) => l.kind === 'work');
    expect(work.business).toBe(tailor);
    expect(work.amount).toBe(30_000); // 30% of the ₦100,000 quote
    expect(quote.total).toBe(50_000);
    expect(quote.refund).toBe(20_000);
  });

  it('fabric still at the shop is refunded as before', async () => {
    const { order } = bespokeOrder('pending');
    const { svc } = service();
    const quote = await svc.quoteCancellation(order, 70_000);
    expect(quote.lines.some((l: any) => l.kind === 'fabric')).toBe(false);
    expect(quote.refund).toBe(40_000);
  });

  it('fabric sent is kept even when the work fee is switched off', async () => {
    const { order } = bespokeOrder('in_transit');
    const { svc } = service();
    svc.platformSettingsModel = { findOne: () => ({ lean: async () => ({ custom_cancellation_fee_percent: 0 }) }) };
    const quote = await svc.quoteCancellation(order, 70_000);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].kind).toBe('fabric');
    expect(quote.refund).toBe(50_000);
  });
});

describe('tailor walks away after the fabric went out', () => {
  it('customer refunded in full, fabric shop keeps its money, tailor charged', async () => {
    const { order, fabricItem, tailorItem } = bespokeOrder('delivered');
    const { svc, reconcileBusinessWallet, reverseBusinessEarnings, processPartialRefund, create } = service();
    const { refundAmount } = await svc._rejectItems(order, tailor, [tailorItem], 'Cannot make it', {
      vendorAtFault: true,
    });
    expect(refundAmount).toBe(50_000 + 20_000 + 1_500);
    expect(processPartialRefund).toHaveBeenCalledWith(order, 71_500, 'Cannot make it');
    expect(reverseBusinessEarnings).not.toHaveBeenCalledWith(order, fabricShop, String(fabricItem._id));
    expect(reconcileBusinessWallet).toHaveBeenCalledWith(
      tailor,
      { balance: -20_000 },
      expect.objectContaining({ metadata: { reason: 'fabric_on_tailor' } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    const notice = create.mock.calls.find((c: any[]) => c[0].title === 'Fabric charged to your balance');
    expect(notice?.[0].body).toMatch(/₦20,000/);
  });

  it('not the tailor’s doing (a sell-out): the fabric shop is reversed as before', async () => {
    const { order, fabricItem, tailorItem } = bespokeOrder('delivered');
    const { svc, reconcileBusinessWallet, reverseBusinessEarnings } = service();
    await svc._rejectItems(order, tailor, [tailorItem], 'Sold out');
    expect(reverseBusinessEarnings).toHaveBeenCalledWith(order, fabricShop, String(fabricItem._id));
    expect(reconcileBusinessWallet).not.toHaveBeenCalled();
  });

  it('fabric that never left the shop: reversed and back on the shelf, tailor not charged', async () => {
    const { order, fabricItem, tailorItem } = bespokeOrder('pending');
    const { svc, reconcileBusinessWallet, reverseBusinessEarnings } = service();
    await svc._rejectItems(order, tailor, [tailorItem], 'Cannot make it', { vendorAtFault: true });
    expect(reverseBusinessEarnings).toHaveBeenCalledWith(order, fabricShop, String(fabricItem._id));
    expect(svc.productService.restoreInventory).toHaveBeenCalledWith(order._id, fabricShop, String(fabricItem._id));
    expect(reconcileBusinessWallet).not.toHaveBeenCalled();
  });
});
