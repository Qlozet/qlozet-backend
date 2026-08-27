import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { TicketStatus } from '../ticket/schema/ticket.schema';

/**
 * getAdminProfileOverview() backs the admin console's profile drawer. It reuses
 * getAdminDashboardMetrics() for the marketplace counters and reads the ticket
 * collection for this admin's own workload, so most of what matters here is
 * which filter reaches which count.
 */

const ADMIN = '6a42dd1d1ef94a89f9f04679';

interface TicketFilter {
  assigned_to?: Types.ObjectId;
  status?: { $in: TicketStatus[] };
  updatedAt?: { $gte: Date };
  createdAt?: { $gte: Date };
}

const buildService = (overrides: {
  dashboard?: Record<string, unknown>;
  counts?: number[];
  distinctBusinesses?: unknown[];
  tasks?: unknown[];
}) => {
  const counts = [...(overrides.counts ?? [])];
  const countFilters: TicketFilter[] = [];
  let distinctFilter: TicketFilter | undefined;
  let findFilter: TicketFilter | undefined;

  const service = Object.create(OrderService.prototype) as OrderService;

  Object.assign(service, {
    ticketModel: {
      countDocuments: jest.fn((filter: TicketFilter) => {
        countFilters.push(filter);
        return Promise.resolve(counts.shift() ?? 0);
      }),
      distinct: jest.fn((_field: string, filter: TicketFilter) => {
        distinctFilter = filter;
        return Promise.resolve(overrides.distinctBusinesses ?? []);
      }),
      find: jest.fn((filter: TicketFilter) => {
        findFilter = filter;
        return {
          select: () => ({
            populate: () => ({
              sort: () => ({
                limit: () => ({
                  lean: () => Promise.resolve(overrides.tasks ?? []),
                }),
              }),
            }),
          }),
        };
      }),
    },
  });

  const getAdminDashboardMetrics = jest.fn(() =>
    Promise.resolve({
      total_customers: 402,
      total_vendors: 24,
      gross_sales: 1250000,
      ...(overrides.dashboard ?? {}),
    }),
  );
  service.getAdminDashboardMetrics =
    getAdminDashboardMetrics as unknown as OrderService['getAdminDashboardMetrics'];

  return {
    service,
    getAdminDashboardMetrics,
    countFilters,
    getDistinctFilter: () => distinctFilter,
    getFindFilter: () => findFilter,
  };
};

const DONE = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

describe('OrderService.getAdminProfileOverview', () => {
  it('rejects an id that is not an ObjectId', async () => {
    const { service } = buildService({});
    await expect(service.getAdminProfileOverview('nope')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reuses the dashboard roll-up for the marketplace counters', async () => {
    const { service, getAdminDashboardMetrics } = buildService({
      counts: [137, 100, 20],
    });

    const overview = await service.getAdminProfileOverview(ADMIN);

    // Re-counting here would let the drawer and the dashboard cards disagree.
    expect(getAdminDashboardMetrics).toHaveBeenCalled();
    expect(overview.stats.customers).toBe(402);
    expect(overview.stats.vendors).toBe(24);
    expect(overview.metrics.totalSalesOversight).toBe(1250000);
    expect(overview.currency).toBe('NGN');
  });

  it('counts closed tickets platform-wide but resolved tickets per-admin', async () => {
    const { service, countFilters } = buildService({ counts: [137, 100, 20] });

    const overview = await service.getAdminProfileOverview(ADMIN);

    // 1st count: platform-wide — no assignee filter.
    expect(countFilters[0]).toEqual({ status: { $in: DONE } });
    expect(overview.stats.ticketsClosed).toBe(137);

    // 2nd count: this admin, all-time.
    expect(countFilters[1].assigned_to?.toString()).toBe(ADMIN);
    expect(countFilters[1].status).toEqual({ $in: DONE });
    expect(countFilters[1].updatedAt).toBeUndefined();
    expect(overview.metrics.ticketsResolved).toBe(100);
  });

  it('scopes tasksCompleted to the window so it is not a duplicate of ticketsResolved', async () => {
    const { service, countFilters } = buildService({ counts: [137, 100, 20] });

    const overview = await service.getAdminProfileOverview(ADMIN);

    // 3rd count: this admin AND the window. Two identical numbers under
    // different labels in the drawer would read as a bug.
    expect(countFilters[2].assigned_to?.toString()).toBe(ADMIN);
    expect(countFilters[2].updatedAt?.$gte).toBeInstanceOf(Date);
    expect(overview.stats.tasksCompleted).toBe(20);
    expect(overview.stats.tasksCompleted).not.toBe(
      overview.metrics.ticketsResolved,
    );
  });

  it('looks back exactly the window it reports', async () => {
    const { service, getFindFilter } = buildService({ counts: [0, 0, 0] });

    const overview = await service.getAdminProfileOverview(ADMIN);

    const since = getFindFilter()?.createdAt?.$gte as Date;
    const days = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(days).toBe(overview.taskWindowDays);
    expect(overview.taskWindowDays).toBe(30);
  });

  it('counts distinct vendors this admin handled a ticket for', async () => {
    const { service, getDistinctFilter } = buildService({
      counts: [0, 0, 0],
      // A null slips in when a ticket lost its business reference; counting it
      // would inflate the figure.
      distinctBusinesses: [new Types.ObjectId(), new Types.ObjectId(), null],
    });

    const overview = await service.getAdminProfileOverview(ADMIN);

    expect(getDistinctFilter()?.assigned_to?.toString()).toBe(ADMIN);
    expect(overview.metrics.vendorsManaged).toBe(2);
  });

  it('maps ticket status onto the drawer’s completed / pending tabs', async () => {
    const { service } = buildService({
      counts: [0, 0, 0],
      tasks: [
        {
          _id: new Types.ObjectId(),
          issue_type: 'Payout not received',
          status: TicketStatus.RESOLVED,
          business: { business_name: 'Ankara Bliss' },
          createdAt: new Date('2026-08-22T09:31:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          issue_type: 'Product rejected',
          status: TicketStatus.IN_PROGRESS,
          business: null,
          createdAt: new Date('2026-08-20T09:31:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          issue_type: 'Refund query',
          status: TicketStatus.CLOSED,
          business: { business_name: 'Zuri' },
          createdAt: new Date('2026-08-18T09:31:00Z'),
        },
      ],
    });

    const overview = await service.getAdminProfileOverview(ADMIN);

    expect(overview.tasks.map((task) => task.status)).toEqual([
      'completed',
      'pending',
      'completed',
    ]);
    // issue_type is the headline; the description is far too long for a row.
    expect(overview.tasks[0].title).toBe('Payout not received');
    expect(overview.tasks[0].vendor).toBe('Ankara Bliss');
    // A ticket whose business could not be resolved shows no vendor rather
    // than an empty string that would render as a stray separator.
    expect(overview.tasks[1].vendor).toBeNull();
    expect(overview.tasks[0].at).toEqual(new Date('2026-08-22T09:31:00Z'));
  });

  it('returns an empty task list for an admin with nothing assigned', async () => {
    const { service } = buildService({ counts: [0, 0, 0] });

    const overview = await service.getAdminProfileOverview(ADMIN);

    expect(overview.tasks).toEqual([]);
    expect(overview.metrics.vendorsManaged).toBe(0);
  });
});
