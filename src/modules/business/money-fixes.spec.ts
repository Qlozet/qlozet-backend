import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { discountAmount } from '../products/discount-amount';
import { PriceCalculationService } from '../orders/orders.price-calculation';
import { WebhookService } from '../webhook/webhook.service';
import { BespokeService } from '../bespoke/bespoke.service';
import { ReturnsService } from '../returns/returns.service';
import { DisputesService } from '../disputes/disputes.service';

/**
 * Money holes found in the pilot QA review (Known bugs BUG-05, 06, 08, 09 in
 * the staging checklist).
 */

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

/** A Mongoose-style query chain whose end resolves to `rows`. */
const chain = (rows: any) => {
  const q: any = {};
  for (const step of ['sort', 'skip', 'limit', 'populate', 'select']) {
    q[step] = () => q;
  }
  q.lean = async () => rows;
  q.then = (ok: any, bad: any) => Promise.resolve(rows).then(ok, bad);
  return q;
};

describe('BUG-09: one discount rule for listings and checkout', () => {
  it('a fixed store-wide discount takes off the amount, not a percentage', () => {
    const d = { type: 'store_wide', value_type: 'fixed', value: 500 };
    expect(discountAmount(25_000, d)).toBe(500);
  });

  it('a store-wide discount with no value_type is still a percentage', () => {
    expect(discountAmount(25_000, { type: 'store_wide', value: 10 })).toBe(2_500);
  });

  it('never takes more than the price', () => {
    expect(discountAmount(1_000, { type: 'percentage', value: 150 })).toBe(1_000);
    expect(discountAmount(1_000, { type: 'fixed', value: 5_000 })).toBe(1_000);
    expect(discountAmount(1_000, { type: 'fixed', value: -50 })).toBe(0);
  });

  it('reads value_type on category discounts', () => {
    expect(discountAmount(10_000, { type: 'category_specific', value_type: 'percentage', value: 20 })).toBe(2_000);
    expect(discountAmount(10_000, { type: 'category_specific', value: 700 })).toBe(700);
  });

  it("checkout for a customizable item uses it: the plan's N35,000 example and a store-wide N500", () => {
    const pricing: any = Object.create(PriceCalculationService.prototype);
    expect(pricing.applyDiscountToTotal(35_000, { type: 'percentage', value: 10 })).toBe(3_500);
    expect(
      pricing.applyDiscountToTotal(25_000, { type: 'store_wide', value_type: 'fixed', value: 500 }),
    ).toBe(500);
  });
});

describe('BUG-05: a reversed payout goes back to the vendor', () => {
  const setup = (status: string) => {
    const businessId = new Types.ObjectId().toString();
    const txn: any = {
      reference: 'PAYOUT-1',
      channel: 'payout',
      wallet: new Types.ObjectId(),
      amount: 5_000,
      status,
      metadata: { business_id: businessId },
      save: jest.fn(),
    };
    const business: any = {
      lifetime_paid_out: status === 'success' ? 5_000 : 0,
      payout_history: status === 'success' ? ['PAYOUT-1'] : [],
      save: jest.fn(),
    };
    const creditWallet = jest.fn().mockResolvedValue({});
    const service: any = Object.create(WebhookService.prototype);
    Object.assign(service, {
      logger: quiet,
      transactionService: { findByReference: async () => txn },
      walletsService: { creditWallet },
      businessModel: { findById: async () => business },
      orderModel: { updateMany: jest.fn() },
    });
    const send = (event: string) =>
      service.handlePaystackWebhook({ event, data: { reference: 'PAYOUT-1' } });
    return { txn, business, creditWallet, send };
  };

  it('restores the wallet once and undoes the paid-out totals', async () => {
    const { txn, business, creditWallet, send } = setup('success');
    await send('transfer.reversed');
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(creditWallet).toHaveBeenCalledWith(String(txn.wallet), 5_000);
    expect(txn.status).toBe('reversed');
    expect(business.lifetime_paid_out).toBe(0);
    expect(business.payout_history).toEqual([]);

    // Paystack retries, and a late success must not count it as paid again.
    await send('transfer.reversed');
    await send('transfer.success');
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(txn.status).toBe('reversed');
    expect(business.lifetime_paid_out).toBe(0);
  });

  it('a reversal before any success just restores the wallet', async () => {
    const { creditWallet, business, send, txn } = setup('pending');
    await send('transfer.reversed');
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(txn.status).toBe('reversed');
    expect(business.save).not.toHaveBeenCalled();
  });
});

describe('BUG-06: a wallet-paid bespoke order takes the fabric out of stock', () => {
  const finalize = async (updateInventory: jest.Mock) => {
    const service: any = Object.create(BespokeService.prototype);
    const orderUpdate = jest.fn().mockResolvedValue({});
    Object.assign(service, {
      logger: quiet,
      quoteModel: { updateMany: jest.fn() },
      businessService: { recordBusinessEarnings: jest.fn() },
      platformSettingsModel: { findOne: () => chain({}) },
      businessEarningsModel: { updateMany: jest.fn() },
      orderModel: { updateOne: orderUpdate },
      productService: { updateInventory },
    });
    const order: any = { _id: new Types.ObjectId(), save: jest.fn(), markModified: jest.fn() };
    await service.finalizeBespokeOrder(
      order,
      { _id: new Types.ObjectId(), save: jest.fn() },
      { _id: new Types.ObjectId(), save: jest.fn() },
    );
    return { order, orderUpdate };
  };

  it('deducts stock for the order', async () => {
    const updateInventory = jest.fn().mockResolvedValue(undefined);
    const { order } = await finalize(updateInventory);
    expect(updateInventory).toHaveBeenCalledWith(order._id);
  });

  it('a stock failure flags the paid order instead of undoing the payment', async () => {
    const updateInventory = jest.fn().mockRejectedValue(new Error('not enough yards'));
    const { order, orderUpdate } = await finalize(updateInventory);
    expect(orderUpdate).toHaveBeenCalledWith(
      { _id: order._id },
      { $set: { inventory_deduction_failed: true } },
    );
  });
});

describe('BUG-08: an item is refunded once', () => {
  const store = new Types.ObjectId().toString();
  const shirt = new Types.ObjectId().toString();
  const otherShopsBag = new Types.ObjectId().toString();

  const returnsService = (finishedReturns: any[]) => {
    const create = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
    const service: any = Object.create(ReturnsService.prototype);
    Object.assign(service, {
      logger: quiet,
      orderModel: {
        findOne: async () => ({
          _id: new Types.ObjectId(),
          reference: 'ORD-9',
          shipments: [{ business: store, delivered_at: new Date() }],
          items: [
            { business: store, product: shirt, clothing_type: 'ready_to_wear' },
            { business: new Types.ObjectId().toString(), product: otherShopsBag },
          ],
        }),
      },
      platformSettingsModel: { findOne: () => chain({ return_window_days: 7 }) },
      returnModel: { findOne: async () => null, find: () => chain(finishedReturns), create },
      vendorRecipients: { resolve: async () => [] },
      notificationsService: { create: jest.fn().mockResolvedValue({}) },
    });
    return { service, create };
  };

  const dto = (ids: string[]) => ({
    order_reference: 'ORD-9',
    business_id: store,
    item_ids: ids,
    reason: 'wrong_size',
  });

  it('refuses to return an item that was already returned and refunded', async () => {
    const { service, create } = returnsService([{ items: [new Types.ObjectId(shirt)] }]);
    await expect(
      service.requestReturn(new Types.ObjectId().toString(), dto([shirt])),
    ).rejects.toThrow('already been returned');
    expect(create).not.toHaveBeenCalled();
  });

  it("stores only this store's items, not every id sent", async () => {
    const { service, create } = returnsService([]);
    await service.requestReturn(new Types.ObjectId().toString(), dto([shirt, otherShopsBag]));
    const saved = create.mock.calls[0][0].items.map(String);
    expect(saved).toEqual([shirt]);
  });

  it('marking received twice refunds once', async () => {
    const refund = jest.fn();
    const service: any = Object.create(ReturnsService.prototype);
    Object.assign(service, {
      logger: quiet,
      returnModel: {
        findById: async () => ({
          _id: new Types.ObjectId(),
          business: new Types.ObjectId(store),
          status: 'vendor_approved',
        }),
        updateOne: async () => ({ modifiedCount: 0 }),
      },
      walletsService: { refundToCustomerWallet: refund },
    });
    await expect(service.markReceived('r1', store)).rejects.toThrow(BadRequestException);
    expect(refund).not.toHaveBeenCalled();
  });

  it('a dispute cannot fully refund items already refunded by a return', async () => {
    const order = {
      _id: new Types.ObjectId(),
      items: [{ business: new Types.ObjectId(store), product: new Types.ObjectId(shirt), total_price: 20_000 }],
    };
    const service: any = Object.create(DisputesService.prototype);
    const disputeModel: any = {
      findById: async () => ({ status: 'open', order: order._id, business: new Types.ObjectId(store) }),
      db: { models: { Return: { find: () => chain([{ items: [new Types.ObjectId(shirt)] }]) } } },
    };
    Object.assign(service, {
      logger: quiet,
      disputeModel,
      orderModel: { findById: async () => order },
      businessEarningsModel: { find: async () => [{ amount: 20_000, net_amount: 18_000 }] },
    });
    await expect(
      service.resolveDispute('d1', 'admin', { resolution: 'full_refund' }),
    ).rejects.toThrow('already refunded through a return');
  });
});
