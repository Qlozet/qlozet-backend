import { Types } from 'mongoose';
import { OrderService } from './orders.service';

/**
 * getBusinessChart() backs the vendor dashboard's four cards. The "Total
 * Orders" card used to count only processing/completed/returned orders -
 * leaving out everything awaiting confirmation and everything cancelled,
 * while counting paid reservation fees - so it never matched the orders page
 * or the list. And "Average orders per day" divided by the number of days
 * that had an order, so three orders in a year read as "2 a day".
 */
const BUSINESS = new Types.ObjectId();

const buildService = (facet: { current: any[]; previous: any[] }) => {
  const aggregations: unknown[][] = [];
  const service = Object.create(OrderService.prototype) as any;
  const chart = jest.fn().mockResolvedValue({ data: {} });
  Object.assign(service, {
    orderModel: {
      aggregate: jest.fn((pipeline: unknown[]) => {
        aggregations.push(pipeline);
        return Promise.resolve([facet]);
      }),
    },
    businessEarningsModel: {
      aggregate: jest.fn().mockResolvedValue([{ current: [], previous: [] }]),
    },
    getBusinessOrdersByGenderChart: chart,
    getBusinessOrdersByLocationChart: chart,
    getBusinessOrdersByProductChart: chart,
    getBusinessOrdersByProductKindChart: chart,
    getBusinessOrderCountByDayChart: chart,
  });
  return { service, aggregations };
};

const row = (status: string, daysAgo = 1) => ({
  _id: new Types.ObjectId(),
  createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  status,
});

describe('OrderService.getBusinessChart - summary cards', () => {
  it('counts the same orders the list shows: every status, paid, not a reservation fee', async () => {
    const { service, aggregations } = buildService({
      current: [row('in_review'), row('processing'), row('cancelled'), row('cancelled')],
      previous: [],
    });

    const result = await service.getBusinessChart(BUSINESS.toHexString(), '7d');

    expect(result.summary.totalOrders).toBe(4);
    const [first] = aggregations[0] as Record<string, any>[];
    // Order-level scope, no $unwind and no status whitelist in front of it.
    expect(Object.keys(first)).toEqual(['$match']);
    expect(first.$match.status).toBeUndefined();
    expect(first.$match.$or[0]['items.business'].equals(BUSINESS)).toBe(true);
    expect(first.$match.$or[1]['shipments.business'].equals(BUSINESS)).toBe(true);
    expect(first.$match.type).toEqual({ $ne: 'reservation' });
    expect(first.$match.payment_status).toEqual({ $ne: 'unpaid' });
  });

  it('averages over every day in the window, not only the days with an order', async () => {
    const { service } = buildService({
      current: [row('processing', 1), row('processing', 1), row('completed', 3)],
      previous: [],
    });

    const result = await service.getBusinessChart(BUSINESS.toHexString(), '7d');

    // 3 orders / 7 days, to one decimal - the old formula said 2 (3 orders
    // over 2 distinct days, rounded).
    expect(result.summary.averageOrdersPerDay).toBe(0.4);
  });

  it('still reads returns off the returned status', async () => {
    const { service } = buildService({
      current: [row('returned'), row('completed')],
      previous: [row('returned')],
    });

    const result = await service.getBusinessChart(BUSINESS.toHexString(), '30d');

    expect(result.summary.totalReturns).toBe(1);
    expect(result.summary.totalReturnsChange).toBe('+0.0%');
  });
});
