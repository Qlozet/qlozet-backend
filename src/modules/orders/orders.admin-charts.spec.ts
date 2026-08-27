import { OrderService } from './orders.service';
import { OrderStatus } from './schemas/orders.schema';
import type { ChartDto } from '../platform/dto/admin-dashboard-charts.dto';

/**
 * getAdminChart() fans out over seven aggregations across two collections and
 * reshapes them into the `{ chartType, title, series }` envelope the dashboard
 * reads. The service constructor pulls in two dozen collaborators none of these
 * methods touch, so the models are attached to a bare instance — keeping the
 * test about the pipelines and the reshaping, not the wiring.
 */

/** Only the stage shapes these pipelines actually build. */
interface MatchStage {
  payment_status?: string;
  released?: boolean;
  release_date?: null | Record<string, unknown>;
  createdAt?: { $gte: Date; $lt: Date };
}

interface GroupStage {
  _id?: unknown;
  value?: unknown;
  count?: unknown;
}

interface Stage {
  $match?: MatchStage;
  $group?: GroupStage;
}

type AggregateStub = (pipeline: Stage[]) => unknown[];

const buildService = (overrides: {
  orderAggregate?: AggregateStub;
  earningAggregate?: AggregateStub;
  newestOrder?: { createdAt: Date }[];
}) => {
  const orderPipelines: Stage[][] = [];
  const earningPipelines: Stage[][] = [];

  const service = Object.create(OrderService.prototype) as OrderService;

  Object.assign(service, {
    orderModel: {
      aggregate: jest.fn((pipeline: Stage[]) => {
        orderPipelines.push(pipeline);
        return Promise.resolve(overrides.orderAggregate?.(pipeline) ?? []);
      }),
      // latestOrderYear(): find().sort().select().limit().lean()
      find: jest.fn(() => ({
        sort: () => ({
          select: () => ({
            limit: () => ({
              lean: () => Promise.resolve(overrides.newestOrder ?? []),
            }),
          }),
        }),
      })),
    },
    businessEarningsModel: {
      aggregate: jest.fn((pipeline: Stage[]) => {
        earningPipelines.push(pipeline);
        return Promise.resolve(overrides.earningAggregate?.(pipeline) ?? []);
      }),
    },
  });

  return { service, orderPipelines, earningPipelines };
};

/** The pipeline's `$match`, or an empty object when it has none. */
const matchOf = (pipeline: Stage[]): MatchStage =>
  pipeline.find((stage) => stage.$match)?.$match ?? {};

const groupOf = (pipeline: Stage[]): GroupStage =>
  pipeline.find((stage) => stage.$group)?.$group ?? {};

/** True when the pipeline groups by calendar month of the given field. */
const groupsByMonthOf = (pipeline: Stage[], field: string): boolean => {
  const id = groupOf(pipeline)._id;
  return (
    typeof id === 'object' &&
    id !== null &&
    (id as { $month?: string }).$month === field
  );
};

describe('OrderService monthly series', () => {
  it('returns a dense twelve-point Jan–Dec series, zero-filling empty months', async () => {
    const { service } = buildService({
      // Only March and August carry revenue.
      orderAggregate: () => [
        { _id: 3, value: 40000 },
        { _id: 8, value: 156921.99 },
      ],
    });

    const chart = await service.getPlatformRevenueByMonthChart(2026);
    const points = chart.data.series[0].data;

    expect(points).toHaveLength(12);
    expect(points.map((p) => p.label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
    expect(points[2]).toEqual({ label: 'Mar', value: 40000 });
    expect(points[7]).toEqual({ label: 'Aug', value: 156921.99 });
    // Every other month is an explicit 0, not a gap — the bar chart needs a
    // point for each tick or the axis goes ragged.
    expect(points.filter((p) => p.value === 0)).toHaveLength(10);
  });

  it('counts only paid orders as revenue, and scopes them to the requested year', async () => {
    const { service, orderPipelines } = buildService({});

    await service.getPlatformRevenueByMonthChart(2026);

    const match = matchOf(orderPipelines[0]);
    expect(match.payment_status).toBe('paid');
    // UTC bounds, half-open — a 31 Dec 23:00 UTC order belongs to 2026, and a
    // 1 Jan order does not get double counted into the previous year.
    expect(match.createdAt?.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(match.createdAt?.$lt).toEqual(new Date(Date.UTC(2027, 0, 1)));
    expect(groupsByMonthOf(orderPipelines[0], '$createdAt')).toBe(true);
  });

  it('counts every order for volume, paid or not', async () => {
    const { service, orderPipelines } = buildService({});

    await service.getPlatformOrderCountByMonthChart(2026);

    const match = matchOf(orderPipelines[0]);
    expect(match.payment_status).toBeUndefined();
    expect(match.createdAt?.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });

  it('rounds money to kobo so float addition does not leak into the card', async () => {
    const { service } = buildService({
      orderAggregate: () => [{ _id: 1, value: 0.1 + 0.2 }],
    });

    const chart = await service.getPlatformRevenueByMonthChart(2026);
    expect(chart.data.series[0].data[0].value).toBe(0.3);
  });
});

describe('OrderService.getPlatformOrdersByStatusChart', () => {
  it('emits every status, including the ones at zero, highest first', async () => {
    const { service } = buildService({
      orderAggregate: () => [
        { _id: OrderStatus.PROCESSING, count: 48 },
        { _id: OrderStatus.COMPLETED, count: 1 },
      ],
    });

    const chart = await service.getPlatformOrdersByStatusChart();
    const points = chart.data.series[0].data;

    // All seven statuses, so the legend does not reshuffle between refreshes.
    expect(points).toHaveLength(Object.values(OrderStatus).length);
    expect(points[0]).toMatchObject({ label: 'Processing', value: 48 });
    expect(points[1]).toMatchObject({ label: 'Completed', value: 1 });
    expect(points.every((p) => typeof p.color === 'string')).toBe(true);
    // Underscored statuses are humanised for display.
    expect(points.map((p) => p.label)).toContain('In Transit');
  });
});

describe('OrderService.getPlatformExpectedEarningsChart', () => {
  // The unscheduled pipeline is the one asking for a null release_date.
  const scheduledAndUnscheduled: AggregateStub = (pipeline) =>
    matchOf(pipeline).release_date === null
      ? [{ _id: null, value: 84000 }]
      : [
          { _id: { year: 2026, month: 12 }, value: 180000 },
          { _id: { year: 2027, month: 1 }, value: 232500 },
        ];

  it('sums unreleased platform commission, bucketed by release month', async () => {
    const { service } = buildService({
      earningAggregate: scheduledAndUnscheduled,
    });

    const chart = await service.getPlatformExpectedEarningsChart();

    // Labels carry the year: a December release and the following January must
    // not collapse onto the same bar.
    expect(chart.data.series[0].data).toEqual([
      { label: 'Dec 2026', value: 180000 },
      { label: 'Jan 2027', value: 232500 },
    ]);
  });

  it('counts commission with no release date in the total, not in the bars', async () => {
    const { service } = buildService({
      earningAggregate: scheduledAndUnscheduled,
    });

    const chart = await service.getPlatformExpectedEarningsChart();

    // Orders that have not been delivered have no payout clock, so there is no
    // month to plot them in — but the money is still owed and must not vanish
    // from the headline figure.
    expect(chart.data.unscheduled).toBe(84000);
    expect(chart.data.total).toBe(180000 + 232500 + 84000);
    expect(chart.data.series[0].data).toHaveLength(2);
  });

  it('reads commission and only unreleased rows', async () => {
    const { service, earningPipelines } = buildService({});

    await service.getPlatformExpectedEarningsChart();

    for (const pipeline of earningPipelines) {
      expect(matchOf(pipeline).released).toBe(false);
      // The platform's cut, not the vendor's net payout.
      expect(groupOf(pipeline).value).toEqual({ $sum: '$commission' });
    }
  });
});

describe('OrderService weekday series', () => {
  it('returns a dense Sun–Sat series, zero-filling the quiet days', async () => {
    const { service } = buildService({
      // $dayOfWeek is 1=Sun … 7=Sat, so 4 is Wednesday.
      orderAggregate: () => [{ _id: 4, value: 156921.99 }],
    });

    const chart = await service.getPlatformEarningsByDayChart();
    const points = chart.data.series[0].data;

    expect(points.map((p) => p.label)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
    expect(points[3]).toEqual({ label: 'Wed', value: 156921.99 });
    expect(points.filter((p) => p.value === 0)).toHaveLength(6);
  });

  it('buckets weekdays in Lagos time, not UTC', async () => {
    const { service, orderPipelines } = buildService({});

    await service.getPlatformEarningsByDayChart();

    // A Sunday 00:30 Lagos order is still Saturday in UTC; bucketing in UTC
    // would shift the whole week.
    expect(groupOf(orderPipelines[0])._id).toEqual({
      $dayOfWeek: { date: '$createdAt', timezone: 'Africa/Lagos' },
    });
  });

  it('counts revenue from paid orders only, but volume from every order', async () => {
    const { service: revenueService, orderPipelines: revenuePipelines } =
      buildService({});
    await revenueService.getPlatformEarningsByDayChart();
    expect(matchOf(revenuePipelines[0]).payment_status).toBe('paid');

    const { service: countService, orderPipelines: countPipelines } =
      buildService({});
    await countService.getPlatformOrderCountByDayChart();
    expect(matchOf(countPipelines[0]).payment_status).toBeUndefined();
  });
});

describe('OrderService.getAdminChart', () => {
  it('defaults to the year of the most recent order, not the current year', async () => {
    const { service, orderPipelines } = buildService({
      newestOrder: [{ createdAt: new Date('2024-08-15T00:00:00Z') }],
    });

    const bundle = await service.getAdminChart();

    expect(bundle.year).toBe(2024);
    // A staging database whose newest order is old still renders populated
    // months rather than twelve empty bars.
    const revenueMatch = orderPipelines
      .map(matchOf)
      .find((match) => match.payment_status === 'paid');
    expect(revenueMatch?.createdAt?.$gte).toEqual(
      new Date(Date.UTC(2024, 0, 1)),
    );
  });

  it('falls back to the current year when there are no orders at all', async () => {
    const { service } = buildService({ newestOrder: [] });

    const bundle = await service.getAdminChart();

    expect(bundle.year).toBe(new Date().getUTCFullYear());
  });

  it('honours an explicit year', async () => {
    const { service } = buildService({
      newestOrder: [{ createdAt: new Date('2024-08-15T00:00:00Z') }],
    });

    expect((await service.getAdminChart(2026)).year).toBe(2026);
  });

  it('returns every chart the dashboard renders, in the vendor envelope', async () => {
    const { service } = buildService({ newestOrder: [] });

    const bundle = await service.getAdminChart();

    expect(Object.keys(bundle.charts).sort()).toEqual([
      'earningsByDay',
      'expectedEarnings',
      'orderCountByDay',
      'orderCountByMonth',
      'ordersByAudience',
      'ordersByLocation',
      'ordersByProductKind',
      'ordersByStatus',
      'revenueByMonth',
    ]);
    // Object.values() on a DTO class (no index signature) widens to any[],
    // which would let a malformed chart through — walk the typed keys instead.
    const charts: ChartDto[] = [
      bundle.charts.revenueByMonth,
      bundle.charts.orderCountByMonth,
      bundle.charts.earningsByDay,
      bundle.charts.orderCountByDay,
      bundle.charts.ordersByStatus,
      bundle.charts.ordersByAudience,
      bundle.charts.ordersByLocation,
      bundle.charts.ordersByProductKind,
      bundle.charts.expectedEarnings,
    ];
    for (const chart of charts) {
      expect(typeof chart.chartType).toBe('string');
      expect(typeof chart.title).toBe('string');
      expect(Array.isArray(chart.series)).toBe(true);
    }
  });

  it('annotates the bundle with the headline figures, so the client never re-sums a series', async () => {
    const { service } = buildService({
      orderAggregate: (pipeline) =>
        groupsByMonthOf(pipeline, '$createdAt')
          ? [
              { _id: 3, value: 40000 },
              { _id: 8, value: 156921.99 },
            ]
          : [],
      earningAggregate: (pipeline) =>
        matchOf(pipeline).release_date === null
          ? [{ _id: null, value: 84000 }]
          : [{ _id: { year: 2026, month: 12 }, value: 180000 }],
      newestOrder: [{ createdAt: new Date('2026-08-15T00:00:00Z') }],
    });

    const bundle = await service.getAdminChart();

    expect(bundle.summary.revenueThisYear).toBe(196921.99);
    // Both monthly pipelines get the same stub here, so the count series
    // carries the same two buckets.
    expect(bundle.summary.ordersThisYear).toBe(40000 + 156921.99);
    expect(bundle.summary.expectedEarnings).toBe(264000);
    expect(bundle.currency).toBe('NGN');
  });
});
