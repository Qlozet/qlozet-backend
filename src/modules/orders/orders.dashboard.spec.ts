import { OrderService } from './orders.service';
import { OrderStatus } from './schemas/orders.schema';
import { BusinessStatus } from '../business/schemas/business.schema';
import { UserType } from '../ums/schemas';

/**
 * getAdminDashboardMetrics() reads three collections and shapes the admin
 * console's overview cards. The service's constructor pulls in a dozen
 * collaborators this method never touches, so the models are attached to a bare
 * instance instead — keeping the test about the queries, not the wiring.
 */
const buildService = (overrides: {
  orderCounts?: number[];
  topProducts?: unknown[];
  grossSales?: { total: number }[];
  vendorCounts?: number[];
  customerCount?: number;
}) => {
  const orderCounts = [...(overrides.orderCounts ?? [0, 0, 0])];
  const vendorCounts = [...(overrides.vendorCounts ?? [0, 0])];

  const orderCountQueries: unknown[] = [];
  const businessCountQueries: unknown[] = [];
  const userCountQueries: unknown[] = [];
  const aggregations: unknown[][] = [];

  const service = Object.create(OrderService.prototype) as OrderService;

  Object.assign(service, {
    orderModel: {
      countDocuments: jest.fn((query?: unknown) => {
        orderCountQueries.push(query);
        return Promise.resolve(orderCounts.shift() ?? 0);
      }),
      aggregate: jest.fn((pipeline: unknown[]) => {
        aggregations.push(pipeline);
        // The gross sales pipeline is the one that groups; the other is the
        // must-purchase product roll-up.
        const isGrossSales = pipeline.some(
          (stage) => (stage as Record<string, unknown>).$match !== undefined,
        );
        return Promise.resolve(
          isGrossSales
            ? (overrides.grossSales ?? [])
            : (overrides.topProducts ?? []),
        );
      }),
    },
    businessModel: {
      countDocuments: jest.fn((query?: unknown) => {
        businessCountQueries.push(query);
        return Promise.resolve(vendorCounts.shift() ?? 0);
      }),
    },
    userModel: {
      countDocuments: jest.fn((query?: unknown) => {
        userCountQueries.push(query);
        return Promise.resolve(overrides.customerCount ?? 0);
      }),
    },
  });

  return {
    service,
    orderCountQueries,
    businessCountQueries,
    userCountQueries,
    aggregations,
  };
};

describe('OrderService.getAdminDashboardMetrics', () => {
  it('returns every metric the admin overview cards read', async () => {
    const { service } = buildService({
      orderCounts: [131, 1, 48],
      vendorCounts: [24, 11],
      customerCount: 402,
      grossSales: [{ total: 1250000 }],
      topProducts: [
        {
          product_id: 'p1',
          name: 'Butterfly Two-piece Dress',
          totalOrdered: 9,
        },
      ],
    });

    await expect(service.getAdminDashboardMetrics()).resolves.toEqual({
      total_orders: 131,
      orders_delivered: 1,
      orders_in_transit: 48,
      total_vendors: 24,
      verified_vendors: 11,
      total_customers: 402,
      gross_sales: 1250000,
      must_purchase_products: [
        {
          product_id: 'p1',
          name: 'Butterfly Two-piece Dress',
          totalOrdered: 9,
        },
      ],
    });
  });

  it('counts orders by delivered and in-transit status', async () => {
    const { service, orderCountQueries } = buildService({});
    await service.getAdminDashboardMetrics();

    expect(orderCountQueries[0]).toBeUndefined(); // every order
    expect(orderCountQueries[1]).toEqual({ status: OrderStatus.COMPLETED });
    expect(orderCountQueries[2]).toEqual({ status: OrderStatus.PROCESSING });
  });

  it('counts all vendors and, separately, the verified ones', async () => {
    const { service, businessCountQueries } = buildService({});
    await service.getAdminDashboardMetrics();

    expect(businessCountQueries[0]).toBeUndefined(); // every business
    expect(businessCountQueries[1]).toEqual({
      status: BusinessStatus.VERIFIED,
    });
  });

  // Must match fetchCustomers(), or the card and the customers table disagree.
  it('counts customers the way the admin customers list does', async () => {
    const { service, userCountQueries } = buildService({});
    await service.getAdminDashboardMetrics();

    expect(userCountQueries[0]).toEqual({ type: UserType.CUSTOMER });
  });

  it('sums gross sales over paid orders only', async () => {
    const { service, aggregations } = buildService({
      grossSales: [{ total: 5000 }],
    });
    await service.getAdminDashboardMetrics();

    const grossSalesPipeline = aggregations.find((pipeline) =>
      pipeline.some(
        (stage) => (stage as Record<string, unknown>).$match !== undefined,
      ),
    );
    expect(grossSalesPipeline?.[0]).toEqual({
      $match: { payment_status: 'paid' },
    });
  });

  // An empty platform aggregates to no rows at all, not to a row holding zero.
  it('reports zero gross sales when no order has been paid for', async () => {
    const { service } = buildService({ grossSales: [] });
    const metrics = await service.getAdminDashboardMetrics();

    expect(metrics.gross_sales).toBe(0);
  });

  // Units live inside the selection arrays; summing the arrays themselves is
  // what made every totalOrdered come back as 0.
  it('sums each selection array before adding them up', async () => {
    const { service, aggregations } = buildService({});
    await service.getAdminDashboardMetrics();

    const productPipeline = aggregations.find((pipeline) =>
      pipeline.some(
        (stage) => (stage as Record<string, unknown>).$unwind === '$items',
      ),
    );
    const group = productPipeline?.find(
      (stage) => (stage as Record<string, unknown>).$group !== undefined,
    ) as { $group: { totalOrdered: { $sum: { $add: unknown[] } } } };

    expect(group.$group.totalOrdered.$sum.$add).toEqual([
      { $sum: '$items.color_variant_selections.quantity' },
      { $sum: '$items.fabric_selections.quantity' },
      { $sum: '$items.accessory_selections.quantity' },
    ]);
  });
});
