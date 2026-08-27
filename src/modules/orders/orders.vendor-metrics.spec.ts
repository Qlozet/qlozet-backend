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
    expect(getDistinctArgs()?.[1]).toEqual({ 'items.business': BUSINESS });
    expect(metrics.total_customers).toBe(2);
  });

  it('scopes every figure to the one vendor', async () => {
    const { service, orderCountQueries, getProductQuery, aggregations } =
      buildService({ counts: [1, 1, 1] });

    await service.getVendorDashboardMetrics(BUSINESS);

    for (const query of orderCountQueries) {
      expect(query['items.business']).toEqual(BUSINESS);
    }
    expect(getProductQuery()).toEqual({ business: BUSINESS });

    const grossMatch = (
      aggregations.find((pipeline) =>
        (pipeline as Record<string, any>[]).some(
          (stage) => stage.$group?.total?.$sum === '$total',
        ),
      ) as Record<string, any>[]
    ).find((stage) => stage.$match)!.$match;
    expect(grossMatch['items.business']).toEqual(BUSINESS);
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
