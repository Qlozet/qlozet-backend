import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderStatus } from './schemas/orders.schema';

/**
 * Cancellation fee: a customer who cancels a custom or bespoke item after its
 * tailor confirmed it forfeits a share of that item, paid to the tailor.
 * Cancelling earlier, ready-to-wear items, declined items and any
 * cancellation the vendor causes stay free.
 */

const TAILOR = new Types.ObjectId();
const SHOP = new Types.ObjectId();
const CUSTOMER = new Types.ObjectId();
const AGBADA = new Types.ObjectId();
const CAP = new Types.ObjectId();

const lean = (v: unknown) => ({ lean: () => Promise.resolve(v), select: () => ({ lean: () => Promise.resolve(v) }) });

const makeOrder = (patch: Record<string, unknown> = {}) => {
  const items = [
    { _id: new Types.ObjectId(), product: AGBADA, business: TAILOR, total_price: 100_000, clothing_type: 'customize' },
    { _id: new Types.ObjectId(), product: CAP, business: SHOP, total_price: 20_000, clothing_type: 'ready_to_wear' },
  ];
  const order: any = {
    _id: new Types.ObjectId(),
    reference: 'QLZ-1',
    customer: CUSTOMER,
    status: OrderStatus.PROCESSING,
    type: 'standard',
    items,
    shipments: [
      { business: TAILOR, confirmed: true },
      { business: SHOP, confirmed: true },
    ],
    save: jest.fn().mockResolvedValue(undefined),
    ...patch,
  };
  return order;
};

const build = (order: any, opts: { percent?: number; paid?: number; channel?: string } = {}) => {
  const created: any[] = [];
  const reconcile: any[] = [];
  const credits: any[] = [];
  const refunds: any[] = [];
  const service: any = Object.create(OrderService.prototype);
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    orderModel: {
      findOne: jest.fn().mockResolvedValue(order),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    platformSettingsModel: {
      findOne: jest.fn(() => lean({
        custom_cancellation_fee_percent: opts.percent ?? 30,
        platform_commission_type: 'percent',
        platform_commission_percent: 10,
      })),
    },
    transactionService: {
      findByOrderId: jest.fn().mockResolvedValue({
        amount: opts.paid ?? 125_000,
        channel: opts.channel ?? 'checkout',
        reference: 'PAY-1',
        wallet: new Types.ObjectId(),
      }),
      create: jest.fn((t) => {
        refunds.push(t);
        return Promise.resolve(t);
      }),
    },
    walletsService: {
      getOrCreateWallet: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      creditWallet: jest.fn((id, amount) => {
        credits.push(amount);
        return Promise.resolve();
      }),
      reconcileBusinessWallet: jest.fn((business, delta) => {
        reconcile.push({ business: String(business), ...delta });
        return Promise.resolve({});
      }),
    },
    businessEarningsModel: {
      find: jest.fn(() => ({
        select: () => ({
          lean: () =>
            Promise.resolve([
              { item: order.items[0]._id, amount: 100_000, commission: 10_000 },
              { item: order.items[1]._id, amount: 20_000, commission: 2_000 },
            ]),
        }),
      })),
      create: jest.fn((row) => {
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    productService: { restoreInventory: jest.fn().mockResolvedValue(undefined) },
    productModel: {
      find: jest.fn(() => ({
        select: () => ({
          lean: () =>
            Promise.resolve([
              { _id: AGBADA, clothing: { name: 'Agbada' } },
              { _id: CAP, accessory: { name: 'Cap' } },
            ]),
        }),
      })),
    },
    reverseBusinessEarnings: jest.fn().mockResolvedValue(undefined),
    notifyVendorsOrderCancelled: jest.fn().mockResolvedValue(undefined),
  });
  return { service: service as OrderService, created, reconcile, credits, refunds };
};

describe('cancellation fee: the quote', () => {
  it('charges a confirmed custom item, never a ready-to-wear one', async () => {
    const order = makeOrder();
    const { service } = build(order);
    const quote = await service.getCustomerCancellationQuote('QLZ-1', String(CUSTOMER));
    expect(quote.cancellable).toBe(true);
    expect(quote.fee_percent).toBe(30);
    expect(quote.lines).toEqual([
      expect.objectContaining({ name: 'Agbada', fee: 30_000, business_id: String(TAILOR) }),
    ]);
    expect(quote.fee_total).toBe(30_000);
    expect(quote.refund_total).toBe(95_000);
  });

  it('charges a custom item on an order stored without clothing_type (asks the product)', async () => {
    // Order items had no clothing_type field in the schema until 2026-10-20,
    // so every stored order lacks it. The product decides for those.
    const order = makeOrder();
    order.items = order.items.map(({ clothing_type, ...rest }: any) => rest);
    const { service } = build(order);
    (service as any).productModel = {
      find: jest.fn(() => ({
        select: () => ({
          lean: () =>
            Promise.resolve([
              { _id: AGBADA, clothing: { name: 'Agbada', type: 'customize' } },
              { _id: CAP, accessory: { name: 'Cap' } },
            ]),
        }),
      })),
    };
    const quote = await service.getCustomerCancellationQuote('QLZ-1', String(CUSTOMER));
    expect(quote.fee_total).toBe(30_000);
    expect(quote.lines).toEqual([expect.objectContaining({ name: 'Agbada', fee: 30_000 })]);
  });

  it('is free before the tailor confirms', async () => {
    const order = makeOrder({ shipments: [{ business: TAILOR, confirmed: false }, { business: SHOP, confirmed: true }] });
    const { service } = build(order);
    const quote = await service.getCustomerCancellationQuote('QLZ-1', String(CUSTOMER));
    expect(quote.fee_total).toBe(0);
    expect(quote.refund_total).toBe(125_000);
  });

  it('charges every item of a confirmed bespoke order, and nothing on a declined one', async () => {
    const order = makeOrder({ type: 'bespoke' });
    order.items[1].rejected = true;
    const { service } = build(order);
    const quote = await service.getCustomerCancellationQuote('QLZ-1', String(CUSTOMER));
    expect(quote.lines.map((l: any) => l.name)).toEqual(['Agbada']);
  });

  it('a 0% setting makes cancelling free', async () => {
    const { service } = build(makeOrder(), { percent: 0 });
    const quote = await service.getCustomerCancellationQuote('QLZ-1', String(CUSTOMER));
    expect(quote.fee_total).toBe(0);
  });

  it('a shipped order is not cancellable, and says why', async () => {
    const { service } = build(makeOrder({ status: OrderStatus.IN_TRANSIT }));
    const quote = await service.getCustomerCancellationQuote('QLZ-1', String(CUSTOMER));
    expect(quote.cancellable).toBe(false);
    expect(quote.reason).toMatch(/shipped/);
  });

  it('someone else’s order is not found', async () => {
    const { service } = build(makeOrder());
    await expect(
      service.getCustomerCancellationQuote('QLZ-1', String(new Types.ObjectId())),
    ).rejects.toThrow('Order not found');
  });
});

describe('cancellation fee: cancelling', () => {
  it('refunds the rest and pays the tailor the fee, net of commission, released now', async () => {
    const order = makeOrder();
    const { service, created, reconcile, credits, refunds } = build(order);
    const res: any = await service.cancelOrder('QLZ-1', { customerId: String(CUSTOMER) });

    expect(credits).toEqual([95_000]);
    expect(refunds[0].amount).toBe(95_000);
    expect(refunds[0].description).toMatch(/₦30,000 kept as the cancellation fee/);
    expect(order.refund_status).toBe('partial');
    expect(order.cancellation_fee).toMatchObject({ percent: 30, total: 30_000, refunded: 95_000 });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      amount: 30_000,
      commission: 3_000,
      net_amount: 27_000,
      released: false,
      milestone: 'cancellation_fee',
    });
    expect(created[0].release_date).toBeInstanceOf(Date);
    expect(reconcile).toContainEqual({ business: String(TAILOR), pending: 27_000 });
    expect(res.data.cancellation_fee).toBe(30_000);
  });

  it('a cancellation the customer did not start (vendor, admin) is free', async () => {
    const order = makeOrder();
    const { service, created, credits } = build(order, { channel: 'wallet_checkout' });
    await service.cancelOrder('QLZ-1');
    expect(credits).toEqual([125_000]);
    expect(created).toHaveLength(0);
    expect(order.refund_status).toBe('refunded');
  });
});

describe('cancellation fee: protected from later reversals', () => {
  it('earnings reversals (rejections, the cancelled-order sweep) never touch the fee row', async () => {
    const filters: any[] = [];
    const service: any = Object.create(OrderService.prototype);
    Object.assign(service, {
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      businessEarningsModel: {
        find: jest.fn((f) => {
          filters.push(f);
          return Promise.resolve([]);
        }),
      },
      orderModel: { updateOne: jest.fn().mockResolvedValue({}) },
    });
    await (service as any).reverseBusinessEarnings({ _id: new Types.ObjectId(), reference: 'QLZ-1' });
    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) expect(f.milestone).toEqual({ $ne: 'cancellation_fee' });
  });
});
