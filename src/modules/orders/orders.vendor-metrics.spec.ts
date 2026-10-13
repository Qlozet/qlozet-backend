import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { OrderStatus } from './schemas/orders.schema';

/**
 * getVendorDashboardMetrics() backs both the admin console's per-vendor
 * Analytics cards and the vendor app's own order stats (GET /orders/dashboard).
 * Three of its figures — gross sales, products, customers — were not in the
 * payload at all, so the cards could only ever render a dash.
 */
const BUSINESS = new Types.ObjectId();

/**
 * Every vendor-facing figure starts from the same scope the orders list uses:
 * the vendor sells an item on the order or ships a leg of it, it was paid
 * for, and it is not a reservation-fee order.
 */
const scopedTo = (query: Record<string, any> | undefined) => {
  expect(query?.$or?.[0]?.['items.business']).toEqual(BUSINESS);
  expect(query?.$or?.[1]?.['shipments.business']).toEqual(BUSINESS);
  expect(query?.type).toEqual({ $ne: 'reservation' });
  expect(query?.payment_status).toEqual({ $ne: 'unpaid' });
};

const buildService = (overrides: {
  counts?: number[];
  grossSales?: { total: number }[];
  distinctCustomers?: unknown[];
  productCount?: number;
} = {}) => {
  const counts = [...(overrides.counts ?? [])];
  const orderCountQueries: Record<string, unknown>[] = [];
  const aggregations: unknown[][] = [];
  let distinctArgs: [string, Record<string, unknown>] | undefined;
  let productQuery: Record<string, unknown> | undefined;

  const service = Object.create(OrderService.prototype) as OrderService;

  Object.assign(service, {
    orderModel: {
      countDocuments: jest.fn((query: Record<string, unknown>) => {
        orderCountQueries.push(query);
        return Promise.resolve(counts.shift() ?? 0);
      }),
      aggregate: jest.fn((pipeline: unknown[]) => {
        aggregations.push(pipeline);
        // The gross-sales roll-up is the one grouping to a single total.
        const isGross = pipeline.some(
          (stage) =>
            (stage as Record<string, any>).$group?.total?.$sum === '$total',
        );
        return Promise.resolve(isGross ? (overrides.grossSales ?? []) : []);
      }),
      distinct: jest.fn((field: string, query: Record<string, unknown>) => {
        distinctArgs = [field, query];
        return Promise.resolve(overrides.distinctCustomers ?? []);
      }),
    },
    productModel: {
      countDocuments: jest.fn((query: Record<string, unknown>) => {
        productQuery = query;
        return Promise.resolve(overrides.productCount ?? 0);
      }),
    },
  });

  return {
    service,
    orderCountQueries,
    aggregations,
    getDistinctArgs: () => distinctArgs,
    getProductQuery: () => productQuery,
  };
};

describe('OrderService.getVendorDashboardMetrics', () => {
  it('returns the figures the admin Analytics cards read', async () => {
    const { service } = buildService({
      counts: [12, 5, 3],
      grossSales: [{ total: 72505.5 }],
      productCount: 13,
      distinctCustomers: ['c1', 'c2'],
    });

    const metrics = await service.getVendorDashboardMetrics(BUSINESS);

    expect(metrics).toMatchObject({
      total_orders: 12,
      orders_delivered: 5,
      orders_in_transit: 3,
      gross_sales: 72505.5,
      total_products: 13,
      total_customers: 2,
    });
  });

  it('counts distinct buyers, not orders', async () => {
    // A customer who ordered five times is one customer.
    const { service, getDistinctArgs } = buildService({
      distinctCustomers: ['c1', 'c1', 'c2'].filter(
        (id, i, all) => all.indexOf(id) === i,
      ),
    });

    const metrics = await service.getVendorDashboardMetrics(BUSINESS);

    expect(getDistinctArgs()?.[0]).toBe('customer');
    scopedTo(getDistinctArgs()?.[1]);
    expect(metrics.total_customers).toBe(2);
  });

  it('scopes every figure to the one vendor', async () => {
    const { service, orderCountQueries, getProductQuery, aggregations } =
      buildService({ counts: [1, 1, 1] });

    await service.getVendorDashboardMetrics(BUSINESS);

    for (const query of orderCountQueries) {
      scopedTo(query);
    }
    expect(getProductQuery()).toEqual({ business: BUSINESS });

    const grossMatch = (
      aggregations.find((pipeline) =>
        (pipeline as Record<string, any>[]).some(
          (stage) => stage.$group?.total?.$sum === '$total',
        ),
      ) as Record<string, any>[]
    ).find((stage) => stage.$match)!.$match;
    expect(grossMatch.$or[0]['items.business']).toEqual(BUSINESS);
    expect(grossMatch.type).toEqual({ $ne: 'reservation' });
  });

  it('hides unpaid checkouts and reservation-fee orders from every count, like the list does', async () => {
    // "Total Orders 8" above a list of 4: the card counted abandoned card
    // checkouts (pending + unpaid) and reservation FEE orders (platform
    // revenue, marked completed when the fee settles - so one read as a
    // delivery) that the list deliberately hides.
    const { service, orderCountQueries, aggregations } = buildService({});

    await service.getVendorDashboardMetrics(BUSINESS);

    expect(orderCountQueries).toHaveLength(3);
    for (const query of orderCountQueries) {
      expect(query.payment_status).toEqual({ $ne: 'unpaid' });
      expect(query.type).toEqual({ $ne: 'reservation' });
    }
    const topProducts = aggregations.find((pipeline) =>
      (pipeline as Record<string, any>[]).some(
        (stage) => stage.$group?._id === '$items.product',
      ),
    ) as Record<string, any>[];
    // Scoped at the ORDER level before the items are unwound.
    expect(Object.keys(topProducts[0])).toEqual(['$match']);
    scopedTo(topProducts[0].$match);
    expect(Object.keys(topProducts[1])).toEqual(['$unwind']);
  });

  it('accepts the string id the request carries and still matches as an ObjectId', async () => {
    // req.business.id is a string. countDocuments casts it; an aggregation
    // $match never does, which is why "Most purchased" was empty.
    const { service, aggregations } = buildService({});

    await service.getVendorDashboardMetrics(BUSINESS.toHexString());

    for (const pipeline of aggregations as Record<string, any>[][]) {
      const match = pipeline.find((stage) => stage.$match)!.$match;
      const id = match.$or[0]['items.business'];
      expect(id).toBeInstanceOf(Types.ObjectId);
      expect(id.equals(BUSINESS)).toBe(true);
    }
  });

  it('sums colour-variant units under their real field name', async () => {
    // The schema field is color_variant_selections; `variant_selections`
    // matched nothing, so clothing never counted towards "Most purchased".
    const { service, aggregations } = buildService({});

    await service.getVendorDashboardMetrics(BUSINESS);

    const topProducts = aggregations.find((pipeline) =>
      (pipeline as Record<string, any>[]).some(
        (stage) => stage.$group?._id === '$items.product',
      ),
    ) as Record<string, any>[];
    const total = JSON.stringify(
      topProducts.find((stage) => stage.$group)!.$group.totalOrdered,
    );
    expect(total).toContain('$items.color_variant_selections.quantity');
    expect(total).not.toContain('$items.variant_selections');
    // Each array is summed on its own, then the three are added.
    expect(total).toContain('"$add"');
  });

  it('counts gross sales over paid orders only', async () => {
    const { service, aggregations } = buildService({});

    await service.getVendorDashboardMetrics(BUSINESS);

    const grossMatch = (
      aggregations.find((pipeline) =>
        (pipeline as Record<string, any>[]).some(
          (stage) => stage.$group?.total?.$sum === '$total',
        ),
      ) as Record<string, any>[]
    ).find((stage) => stage.$match)!.$match;
    expect(grossMatch.payment_status).toBe('paid');
  });

  it('reports zeroes rather than undefined for a vendor with no history', async () => {
    // undefined would render as a dash even though zero is the honest answer.
    const { service } = buildService({});

    const metrics = await service.getVendorDashboardMetrics(BUSINESS);

    expect(metrics.gross_sales).toBe(0);
    expect(metrics.total_products).toBe(0);
    expect(metrics.total_customers).toBe(0);
  });

  it('reads delivered and in-transit off the order status', async () => {
    const { service, orderCountQueries } = buildService({ counts: [9, 4, 2] });

    await service.getVendorDashboardMetrics(BUSINESS);

    expect(orderCountQueries[1].status).toBe(OrderStatus.COMPLETED);
    expect(orderCountQueries[2].status).toBe('processing');
  });

  it('resolves the top product name from the kind subdocument', async () => {
    // Products are polymorphic on `kind`; nothing lives at `product.name`, so
    // projecting it sent null for every row and the "Most purchased" card had
    // nothing to render.
    const { service, aggregations } = buildService({});

    await service.getVendorDashboardMetrics(BUSINESS);

    const topProducts = aggregations.find((pipeline) =>
      (pipeline as Record<string, any>[]).some(
        (stage) => stage.$group?._id === '$items.product',
      ),
    ) as Record<string, any>[];
    const project = topProducts.find((stage) => stage.$project)!.$project;

    expect(project.name).not.toBe('$product.name');
    expect(JSON.stringify(project.name)).toContain('$product.clothing.name');
    expect(JSON.stringify(project.name)).toContain('$product.accessory.name');
    expect(JSON.stringify(project.name)).toContain('$product.fabric.name');
  });
});
