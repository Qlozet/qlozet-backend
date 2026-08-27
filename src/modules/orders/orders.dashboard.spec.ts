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
/** The stat-card trend roll-ups are the only $facet pipelines here. */
const isFacet = (pipeline: unknown[]): boolean =>
  pipeline.some((stage) => (stage as Record<string, unknown>).$facet !== undefined);

const buildService = (overrides: {
  orderCounts?: number[];
  topProducts?: unknown[];
  grossSales?: { total: number }[];
  vendorCounts?: number[];
  customerCount?: number;
  /** Rows the $facet trend roll-up returns; defaults to an empty window. */
  trend?: Record<string, { n: number }[]>[];
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
        if (isFacet(pipeline)) return Promise.resolve(overrides.trend ?? [{}]);
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
      // Only the trend roll-up aggregates over businesses.
      aggregate: jest.fn((pipeline: unknown[]) => {
        aggregations.push(pipeline);
        return Promise.resolve(overrides.trend ?? [{}]);
      }),
    },
    userModel: {
      countDocuments: jest.fn((query?: unknown) => {
        userCountQueries.push(query);
        return Promise.resolve(overrides.customerCount ?? 0);
      }),
      aggregate: jest.fn((pipeline: unknown[]) => {
        aggregations.push(pipeline);
        return Promise.resolve(overrides.trend ?? [{}]);
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
      // The stat-card badges. Windowed, unlike everything above it — and 0
      // rather than null here because this fixture's window is empty on both
      // sides, which is a genuine "no movement".
      changes: {
        period_days: 30,
        total_orders: 0,
        orders_delivered: 0,
        orders_in_transit: 0,
        total_vendors: 0,
        verified_vendors: 0,
        total_customers: 0,
        gross_sales: 0,
      },
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

describe('OrderService.getAdminDashboardMetrics — stat-card changes', () => {
  /** Shape the $facet roll-ups return: one doc of `<key>Current|Previous`. */
  const facet = (counts: Record<string, number>) => [
    Object.fromEntries(
      Object.entries(counts).map(([key, n]) => [key, [{ n }]]),
    ),
  ];

  it('reports movement as a percentage to one decimal place', async () => {
    const { service } = buildService({
      trend: facet({ ordersCurrent: 41, ordersPrevious: 40 }),
    });

    const metrics = await service.getAdminDashboardMetrics();

    expect(metrics.changes.total_orders).toBe(2.5);
    expect(metrics.changes.period_days).toBe(30);
  });

  it('reports a fall as a negative number', async () => {
    const { service } = buildService({
      trend: facet({ ordersCurrent: 30, ordersPrevious: 40 }),
    });

    expect((await service.getAdminDashboardMetrics()).changes.total_orders).toBe(
      -25,
    );
  });

  it('reports null, not +100%, when the previous window was empty', async () => {
    // The vendor dashboard calls this "+100%". A first-ever order is not a
    // 100% increase over anything — the card shows no badge instead.
    const { service } = buildService({
      trend: facet({ ordersCurrent: 12, ordersPrevious: 0 }),
    });

    expect((await service.getAdminDashboardMetrics()).changes.total_orders).toBe(
      null,
    );
  });

  it('reports 0 when both windows were empty', async () => {
    // Distinct from the case above: nothing happened either side, which is a
    // real "no movement" rather than an uncomputable one.
    const { service } = buildService({
      trend: facet({ ordersCurrent: 0, ordersPrevious: 0 }),
    });

    expect((await service.getAdminDashboardMetrics()).changes.total_orders).toBe(
      0,
    );
  });

  it('covers every card that has a countable history', async () => {
    const { service } = buildService({
      trend: facet({
        ordersCurrent: 41,
        ordersPrevious: 40,
        deliveredCurrent: 8,
        deliveredPrevious: 10,
        inTransitCurrent: 6,
        inTransitPrevious: 4,
        grossSalesCurrent: 120000,
        grossSalesPrevious: 100000,
        vendorsCurrent: 5,
        vendorsPrevious: 4,
        verifiedVendorsCurrent: 2,
        verifiedVendorsPrevious: 2,
        customersCurrent: 45,
        customersPrevious: 40,
      }),
    });

    const { changes } = await service.getAdminDashboardMetrics();

    expect(changes).toEqual({
      period_days: 30,
      total_orders: 2.5,
      orders_delivered: -20,
      orders_in_transit: 50,
      gross_sales: 20,
      total_vendors: 25,
      verified_vendors: 0,
      total_customers: 12.5,
    });
    // Measurement accuracy has no entry — the metric itself does not exist.
    expect('measurement_accuracy' in changes).toBe(false);
  });

  it('windows the trend without touching the all-time figures', async () => {
    const { service, aggregations } = buildService({
      orderCounts: [131, 1, 48],
      trend: facet({ ordersCurrent: 5, ordersPrevious: 4 }),
    });

    const metrics = await service.getAdminDashboardMetrics();

    // The headline stays all-time; only the badge is windowed.
    expect(metrics.total_orders).toBe(131);

    const orderFacet = aggregations.find((pipeline) =>
      (pipeline as Record<string, unknown>[]).some((stage) => stage.$facet),
    ) as Record<string, any>[];
    const stages = orderFacet[0].$facet as Record<string, any[]>;
    const currentFrom = stages.ordersCurrent[0].$match.createdAt.$gte as Date;
    const previousEnd = stages.ordersPrevious[0].$match.createdAt.$lt as Date;

    // The two windows abut rather than overlap, so nothing is counted twice.
    expect(previousEnd.getTime()).toBe(currentFrom.getTime());
    expect(
      Math.round((Date.now() - currentFrom.getTime()) / 86_400_000),
    ).toBe(30);
  });

  it('measures orders by creation but delivered/in-transit by updatedAt', async () => {
    const { service, aggregations } = buildService({});

    await service.getAdminDashboardMetrics();

    const orderFacet = aggregations.find((pipeline) =>
      (pipeline as Record<string, unknown>[]).some((stage) => stage.$facet),
    ) as Record<string, any>[];
    const stages = orderFacet[0].$facet as Record<string, any[]>;

    expect(stages.ordersCurrent[0].$match.createdAt).toBeDefined();
    // An Order carries no per-status timestamp, so these fall back to
    // updatedAt — a proxy, documented as such on the DTO.
    expect(stages.deliveredCurrent[0].$match.updatedAt).toBeDefined();
    expect(stages.deliveredCurrent[0].$match.createdAt).toBeUndefined();
    expect(stages.inTransitCurrent[0].$match.updatedAt).toBeDefined();
    // Gross sales is money over orders created in the window.
    expect(stages.grossSalesCurrent[0].$match.payment_status).toBe('paid');
    expect(stages.grossSalesCurrent[1].$group.n).toEqual({ $sum: '$total' });
  });
});
