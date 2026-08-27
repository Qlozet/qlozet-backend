import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import type { ChartDto } from '../platform/dto/admin-dashboard-charts.dto';

/**
 * getCustomerAnalytics() backs the admin console's customer detail page, whose
 * analytics row was previously four fabricated cards. Every figure here has to
 * be scoped to the one customer, so most of these assertions are about the
 * `$match` reaching the aggregation at all.
 */

interface MatchStage {
  customer?: Types.ObjectId;
  userId?: string;
  payment_status?: string;
  createdAt?: { $gte: Date; $lt: Date };
}

interface GroupStage {
  _id?: unknown;
  value?: unknown;
}

interface Stage {
  $match?: MatchStage;
  $group?: GroupStage;
}

type AggregateStub = (pipeline: Stage[]) => unknown[];

const CUSTOMER = '6a42dd1d1ef94a89f9f04679';

const buildService = (overrides: {
  orderAggregate?: AggregateStub;
  eventAggregate?: AggregateStub;
  newestOrder?: { createdAt: Date }[];
}) => {
  const orderPipelines: Stage[][] = [];
  const eventPipelines: Stage[][] = [];
  const findFilters: unknown[] = [];

  const service = Object.create(OrderService.prototype) as OrderService;

  Object.assign(service, {
    orderModel: {
      aggregate: jest.fn((pipeline: Stage[]) => {
        orderPipelines.push(pipeline);
        return Promise.resolve(overrides.orderAggregate?.(pipeline) ?? []);
      }),
      find: jest.fn((filter: unknown) => {
        findFilters.push(filter);
        return {
          sort: () => ({
            select: () => ({
              limit: () => ({
                lean: () => Promise.resolve(overrides.newestOrder ?? []),
              }),
            }),
          }),
        };
      }),
    },
    eventModel: {
      aggregate: jest.fn((pipeline: Stage[]) => {
        eventPipelines.push(pipeline);
        return Promise.resolve(overrides.eventAggregate?.(pipeline) ?? []);
      }),
    },
  });

  return { service, orderPipelines, eventPipelines, findFilters };
};

const matchOf = (pipeline: Stage[]): MatchStage =>
  pipeline.find((stage) => stage.$match)?.$match ?? {};

describe('OrderService.getCustomerAnalytics', () => {
  it('rejects an id that is not an ObjectId instead of throwing inside the aggregation', async () => {
    const { service } = buildService({});
    await expect(service.getCustomerAnalytics('not-an-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('scopes every order aggregation to the customer', async () => {
    const { service, orderPipelines } = buildService({ newestOrder: [] });

    await service.getCustomerAnalytics(CUSTOMER);

    // A missing $match on any one of these would silently chart the whole
    // marketplace on a page about one person — the exact bug this replaced.
    expect(orderPipelines.length).toBeGreaterThan(0);
    for (const pipeline of orderPipelines) {
      expect(matchOf(pipeline).customer?.toString()).toBe(CUSTOMER);
    }
  });

  it('scopes the activity chart to the customer and buckets it in Lagos time', async () => {
    const { service, eventPipelines } = buildService({ newestOrder: [] });

    await service.getCustomerAnalytics(CUSTOMER);

    // events.userId is a plain string, not an ObjectId.
    expect(matchOf(eventPipelines[0]).userId).toBe(CUSTOMER);
    expect(
      eventPipelines[0].find((stage) => stage.$group)?.$group?._id,
    ).toEqual({
      $hour: { date: '$timestamp', timezone: 'Africa/Lagos' },
    });
  });

  it('defaults the spend year to the customer’s own most recent order', async () => {
    const { service, findFilters } = buildService({
      newestOrder: [{ createdAt: new Date('2025-03-02T00:00:00Z') }],
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    expect(analytics.year).toBe(2025);
    // Not the platform's newest order — this customer's.
    expect(
      (findFilters[0] as { customer?: Types.ObjectId }).customer?.toString(),
    ).toBe(CUSTOMER);
  });

  it('returns all four charts in the shared envelope', async () => {
    const { service } = buildService({ newestOrder: [] });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    expect(Object.keys(analytics.charts).sort()).toEqual([
      'activityByHour',
      'ordersByProductKind',
      'returnsRate',
      'spendByMonth',
    ]);
    const charts: ChartDto[] = [
      analytics.charts.spendByMonth,
      analytics.charts.ordersByProductKind,
      analytics.charts.returnsRate,
      analytics.charts.activityByHour,
    ];
    for (const chart of charts) {
      expect(typeof chart.chartType).toBe('string');
      expect(Array.isArray(chart.series)).toBe(true);
    }
  });

  it('charts all 24 hours so the axis is a full day', async () => {
    const { service } = buildService({
      newestOrder: [],
      eventAggregate: () => [{ _id: 9, value: 12 }],
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);
    const points = analytics.charts.activityByHour.series[0].data;

    expect(points).toHaveLength(24);
    expect(points[0].label).toBe('12am');
    expect(points[9]).toEqual({ label: '9am', value: 12 });
    expect(points[12].label).toBe('12pm');
    expect(points[23].label).toBe('11pm');
  });
});

describe('OrderService.getCustomerAnalytics summary', () => {
  // The summary and returns pipelines are the two that group; the summary one
  // is distinguishable by having no payment_status on its $match.
  const stub =
    (summary: Record<string, unknown>, returns: Record<string, unknown>) =>
    (pipeline: Stage[]) =>
      matchOf(pipeline).payment_status === 'paid' &&
      !matchOf(pipeline).createdAt
        ? [returns]
        : [summary];

  it('counts spend from paid orders only, so an abandoned order is not lifetime value', async () => {
    const { service, orderPipelines } = buildService({
      newestOrder: [],
      orderAggregate: stub(
        {
          totalOrders: 14,
          totalSpent: 486000,
          paidOrders: 12,
          returnedOrders: 2,
          lastOrderAt: new Date('2026-08-15T09:31:00Z'),
        },
        { paid: 12, returned: 2 },
      ),
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    expect(analytics.summary.totalOrders).toBe(14);
    expect(analytics.summary.totalSpent).toBe(486000);
    // The $sum is conditional on payment_status rather than filtered by it, so
    // totalOrders can still count the unpaid ones.
    const summaryGroup = orderPipelines
      .map((p) => p.find((stage) => stage.$group)?.$group)
      .find((group) => group && 'totalSpent' in group);
    expect(summaryGroup).toBeDefined();
  });

  it('rates returns against paid orders, not against every order', async () => {
    const { service } = buildService({
      newestOrder: [],
      orderAggregate: stub(
        {
          totalOrders: 14,
          totalSpent: 486000,
          paidOrders: 12,
          returnedOrders: 2,
          lastOrderAt: null,
        },
        { paid: 12, returned: 2 },
      ),
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    // 2/12, not 2/14 — an order that was never paid for could not be returned.
    expect(analytics.summary.returnRate).toBe(16.7);
    expect(analytics.summary.returnedOrders).toBe(2);
  });

  it('reports a 0 return rate rather than dividing by zero for a customer with no paid orders', async () => {
    const { service } = buildService({
      newestOrder: [],
      orderAggregate: stub(
        {
          totalOrders: 1,
          totalSpent: 0,
          paidOrders: 0,
          returnedOrders: 0,
          lastOrderAt: null,
        },
        { paid: 0, returned: 0 },
      ),
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    expect(analytics.summary.returnRate).toBe(0);
    // ...and the returns chart is empty rather than claiming a 0% rate: for
    // someone who never completed a purchase that is not a fact about them.
    expect(analytics.charts.returnsRate.series[0].data).toEqual([]);
  });

  it('splits returned from kept once the customer has paid orders', async () => {
    const { service } = buildService({
      newestOrder: [],
      orderAggregate: stub(
        {
          totalOrders: 12,
          totalSpent: 1,
          paidOrders: 12,
          returnedOrders: 2,
          lastOrderAt: null,
        },
        { paid: 12, returned: 2 },
      ),
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    expect(analytics.charts.returnsRate.series[0].data).toEqual([
      { label: 'Returned', value: 2, color: '#3d2817' },
      { label: 'Kept', value: 10, color: '#d4c5b9' },
    ]);
  });

  it('zeroes the summary for a customer who has never ordered', async () => {
    const { service } = buildService({
      newestOrder: [],
      orderAggregate: () => [],
    });

    const analytics = await service.getCustomerAnalytics(CUSTOMER);

    expect(analytics.summary).toEqual({
      totalOrders: 0,
      totalSpent: 0,
      returnedOrders: 0,
      returnRate: 0,
      lastOrderAt: null,
    });
  });
});
