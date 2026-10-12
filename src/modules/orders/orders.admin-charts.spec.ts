import { OrderService } from './orders.service';
import { OrderStatus } from './schemas/orders.schema';
import type { ChartDto } from '../platform/dto/admin-dashboard-charts.dto';

/**
 * getAdminChart() fans out over eight aggregations across two collections and
 * reshapes them into the `{ chartType, title, series }` envelope the dashboard
 * reads, all over ONE time window. The service constructor pulls in two dozen
 * collaborators none of these methods touch, so the models are attached to a
 * bare instance - keeping the test about the pipelines and the reshaping.
 */

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

interface ProjectStage {
  at?: unknown;
  value?: unknown;
}

interface Stage {
  $match?: MatchStage;
  $group?: GroupStage;
  $project?: ProjectStage;
}

type AggregateStub = (pipeline: Stage[]) => unknown[];

const NOW = new Date('2026-10-14T15:30:00Z');

const buildService = (overrides: {
  orderAggregate?: AggregateStub;
  earningAggregate?: AggregateStub;
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

/** The pipeline's first `$match`, or an empty object when it has none. */
const matchOf = (pipeline: Stage[]): MatchStage =>
  pipeline.find((stage) => stage.$match)?.$match ?? {};

const projectOf = (pipeline: Stage[]): ProjectStage =>
  pipeline.find((stage) => stage.$project)?.$project ?? {};

/** A series pipeline: match, then project `{ at, value }`. */
const isSeriesPipeline = (pipeline: Stage[]) => projectOf(pipeline).at !== undefined;

describe('OrderService platform series', () => {
  it('buckets revenue by day over the window, zero-filling, and reads paid orders only', async () => {
    const { service, orderPipelines } = buildService({
      orderAggregate: (pipeline) =>
        isSeriesPipeline(pipeline)
          ? [
              { at: new Date('2026-10-08T10:00:00Z'), value: 40000 },
              { at: new Date('2026-10-08T12:00:00Z'), value: 0.1 + 0.2 },
              { at: new Date('2026-10-13T10:00:00Z'), value: 156921.99 },
            ]
          : [],
    });

    const chart = await service.getPlatformRevenueSeries(service.dashboardRange('7d', NOW));
    const points = chart.data.series[0].data;

    expect(points.map((p) => p.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
    expect(points[0]).toEqual({ label: 'Thu', value: 40000.3 });
    expect(points[5]).toEqual({ label: 'Tue', value: 156921.99 });
    expect(points.filter((p) => p.value === 0)).toHaveLength(5);

    const match = matchOf(orderPipelines[0]);
    expect(match.payment_status).toBe('paid');
    expect(match.createdAt?.$gte).toEqual(new Date('2026-10-07T23:00:00Z')); // Lagos midnight
    expect(match.createdAt?.$lt).toEqual(NOW);
    expect(projectOf(orderPipelines[0]).value).toEqual({ $ifNull: ['$total', 0] });
  });

  it('counts every order for volume, paid or not, and sums commission for platform earnings', async () => {
    const { service, orderPipelines } = buildService({});
    const range = service.dashboardRange('30d', NOW);

    await service.getPlatformOrderCountSeries(range);
    expect(matchOf(orderPipelines[0]).payment_status).toBeUndefined();
    expect(projectOf(orderPipelines[0]).value).toBe(1);

    await service.getPlatformCommissionSeries(range);
    expect(matchOf(orderPipelines[1]).payment_status).toBe('paid');
    expect(projectOf(orderPipelines[1]).value).toEqual({ $ifNull: ['$platform_commission', 0] });
  });

  it('switches to weekly and monthly buckets with the range', async () => {
    const { service } = buildService({});
    const weeks = await service.getPlatformOrderCountSeries(service.dashboardRange('12w', NOW));
    expect(weeks.data.series[0].data).toHaveLength(12);
    expect(weeks.data.unit).toBe('week');
    const months = await service.getPlatformOrderCountSeries(service.dashboardRange('12m', NOW));
    expect(months.data.series[0].data.map((p) => p.label).slice(-2)).toEqual(['Sep', 'Oct']);
    expect(months.data.unit).toBe('month');
  });
});

describe('OrderService.getPlatformOrdersByStatusChart', () => {
  it('emits every status, including the ones at zero, highest first, inside the window', async () => {
    const { service, orderPipelines } = buildService({
      orderAggregate: () => [
        { _id: OrderStatus.COMPLETED, count: 5 },
        { _id: OrderStatus.PENDING, count: 9 },
      ],
    });

    const chart = await service.getPlatformOrdersByStatusChart(service.dashboardRange('7d', NOW));
    const points = chart.data.series[0].data;

    expect(points).toHaveLength(7);
    expect(points[0]).toMatchObject({ label: 'Pending', value: 9 });
    expect(points[1]).toMatchObject({ label: 'Completed', value: 5 });
    expect(points.filter((p) => p.value === 0)).toHaveLength(5);
    expect(matchOf(orderPipelines[0]).createdAt?.$gte).toEqual(new Date('2026-10-07T23:00:00Z'));
  });
});

describe('OrderService.getPlatformExpectedEarningsChart', () => {
  const stub = (overrides: { scheduled?: unknown[]; unscheduled?: unknown[] }) =>
    buildService({
      earningAggregate: (pipeline) =>
        matchOf(pipeline).release_date === null
          ? overrides.unscheduled ?? []
          : overrides.scheduled ?? [],
    });

  it('sums unreleased platform commission, bucketed by release month', async () => {
    const { service } = stub({
      scheduled: [
        { _id: { year: 2026, month: 11 }, value: 120000 },
        { _id: { year: 2026, month: 12 }, value: 180000 },
      ],
      unscheduled: [{ _id: null, value: 84000 }],
    });

    const chart = await service.getPlatformExpectedEarningsChart();
    expect(chart.data.series[0].data).toEqual([
      { label: 'Nov 2026', value: 120000 },
      { label: 'Dec 2026', value: 180000 },
    ]);
    expect(chart.data.total).toBe(384000);
    expect(chart.data.unscheduled).toBe(84000);
  });

  it('reads commission and only unreleased rows', async () => {
    const { service, earningPipelines } = stub({});
    await service.getPlatformExpectedEarningsChart();
    for (const pipeline of earningPipelines) {
      expect(matchOf(pipeline).released).toBe(false);
    }
  });
});

describe('OrderService.getAdminChart', () => {
  it('returns every chart the dashboard renders, in the vendor envelope, over one window', async () => {
    const { service } = buildService({});

    const bundle = await service.getAdminChart('12w', NOW);

    expect(bundle.range).toMatchObject({ key: '12w', unit: 'week', label: 'Last 12 weeks' });
    expect(Object.keys(bundle.charts).sort()).toEqual([
      'expectedEarnings',
      'orderCount',
      'ordersByAudience',
      'ordersByLocation',
      'ordersByProductKind',
      'ordersByStatus',
      'platformEarnings',
      'revenue',
    ]);
    const charts: ChartDto[] = [
      bundle.charts.revenue,
      bundle.charts.orderCount,
      bundle.charts.platformEarnings,
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

  it('falls back to the default window on an unknown range', async () => {
    const { service } = buildService({});
    expect((await service.getAdminChart('whenever', NOW)).range.key).toBe('7d');
  });

  it('annotates the bundle with the headline figures, so the client never re-sums a series', async () => {
    const { service } = buildService({
      orderAggregate: (pipeline) => {
        if (!isSeriesPipeline(pipeline)) return [];
        const value = projectOf(pipeline).value;
        // revenue reads $total, commission reads $platform_commission, volume is 1
        if (value === 1) return [{ at: new Date('2026-10-13T10:00:00Z'), value: 1 }, { at: new Date('2026-10-13T11:00:00Z'), value: 1 }];
        if (JSON.stringify(value).includes('platform_commission')) return [{ at: new Date('2026-10-13T10:00:00Z'), value: 19692.2 }];
        return [{ at: new Date('2026-10-13T10:00:00Z'), value: 196921.99 }];
      },
      earningAggregate: (pipeline) =>
        matchOf(pipeline).release_date === null
          ? [{ _id: null, value: 84000 }]
          : [{ _id: { year: 2026, month: 12 }, value: 180000 }],
    });

    const bundle = await service.getAdminChart('7d', NOW);

    expect(bundle.summary.revenue).toBe(196921.99);
    expect(bundle.summary.orders).toBe(2);
    expect(bundle.summary.platformEarnings).toBe(19692.2);
    expect(bundle.summary.expectedEarnings).toBe(264000);
    expect(bundle.currency).toBe('NGN');
  });
});
