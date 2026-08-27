import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserService } from './services/users.service';
import { UserType } from './schemas';

/**
 * fetchCustomers() backs the admin console's Customers page: the table rows and
 * the four stat cards above them.
 *
 * The service constructor pulls in mail, logistics and size-guide collaborators
 * none of this touches, so the models are attached to a bare instance.
 */
type Pipeline = Record<string, any>[];

const buildService = (overrides: {
  rows?: Record<string, unknown>[];
  count?: number;
  orderStats?: unknown[];
  distinct?: unknown[][];
  /**
   * countDocuments results in call order: the PAGING total first (which does
   * respect the table's filters), then the summary's total, current window and
   * previous window.
   */
  counts?: number[];
  topLocation?: unknown[];
  favourite?: unknown[];
} = {}) => {
  const counts = [...(overrides.counts ?? [])];
  const distinct = [...(overrides.distinct ?? [])];
  const userQueries: Record<string, any>[] = [];
  const pipelines: Pipeline[] = [];
  let findQuery: Record<string, any> | undefined;

  const chain = (result: unknown) => {
    const self: any = {
      skip: () => self,
      limit: () => self,
      sort: () => self,
      lean: () => Promise.resolve(result),
    };
    return self;
  };

  const service = Object.create(UserService.prototype) as UserService;

  Object.assign(service, {
    userModel: {
      find: jest.fn((query: Record<string, any>) => {
        findQuery = query;
        return chain(overrides.rows ?? []);
      }),
      countDocuments: jest.fn((query: Record<string, any>) => {
        userQueries.push(query);
        return Promise.resolve(counts.shift() ?? 0);
      }),
    },
    orderModel: {
      aggregate: jest.fn((pipeline: Pipeline) => {
        pipelines.push(pipeline);
        // The row roll-up groups by customer; the other two are the location
        // and favourite-product cards.
        if (pipeline.some((s) => s.$group?._id === '$customer')) {
          return Promise.resolve(overrides.orderStats ?? []);
        }
        if (pipeline.some((s) => s.$group?.customers)) {
          return Promise.resolve(overrides.topLocation ?? []);
        }
        return Promise.resolve(overrides.favourite ?? []);
      }),
      distinct: jest.fn(() => Promise.resolve(distinct.shift() ?? [])),
    },
  });

  return {
    service,
    userQueries,
    pipelines,
    getFindQuery: () => findQuery,
  };
};

describe('UserService.fetchCustomers — search', () => {
  it('searches the fields the schema actually has', async () => {
    const { service, getFindQuery } = buildService();

    await service.fetchCustomers(1, 5, { search: 'kennedy' });

    // It used to search first_name / last_name / phone — none of which exist on
    // the User document — so only the email clause could ever match.
    const keys = getFindQuery()!.$or.map(
      (clause: Record<string, unknown>) => Object.keys(clause)[0],
    );
    expect(keys).toEqual(['full_name', 'username', 'email', 'phone_number']);
  });

  it('escapes the term, so a phone number is not a broken pattern', async () => {
    const { service, getFindQuery } = buildService();

    await service.fetchCustomers(1, 5, { search: '+234801' });

    expect(getFindQuery()!.$or[0].full_name.source).toBe('\\+234801');
  });

  it('always scopes to customers', async () => {
    const { service, getFindQuery } = buildService();
    await service.fetchCustomers(1, 5);
    expect(getFindQuery()!.type).toBe(UserType.CUSTOMER);
  });
});

describe('UserService.fetchCustomers — per-row order stats', () => {
  const rows = [{ _id: new Types.ObjectId() }, { _id: new Types.ObjectId() }];

  it('joins the order count and last order date onto each row', async () => {
    const lastOrder = new Date('2026-08-15T09:31:00Z');
    const { service } = buildService({
      rows,
      orderStats: [
        { _id: rows[0]._id, total_orders: 4, last_order_at: lastOrder },
      ],
    });

    const result = await service.fetchCustomers(1, 5);

    expect(result.data[0]).toMatchObject({
      total_orders: 4,
      last_order_at: lastOrder,
    });
  });

  it('reports 0 and null for a customer who has never ordered', async () => {
    // Not undefined: the table renders that as a dash, which implies the figure
    // is unknown rather than zero.
    const { service } = buildService({ rows, orderStats: [] });

    const result = await service.fetchCustomers(1, 5);

    expect(result.data[0]).toMatchObject({
      total_orders: 0,
      last_order_at: null,
    });
  });

  it('uses one aggregation for the page, not one query per row', async () => {
    const { service, pipelines } = buildService({ rows });

    await service.fetchCustomers(1, 5);

    const rowRollups = pipelines.filter((p) =>
      p.some((s) => s.$group?._id === '$customer'),
    );
    expect(rowRollups).toHaveLength(1);
    expect(rowRollups[0][0].$match.customer.$in).toHaveLength(2);
  });

  it('skips the join entirely for an empty page', async () => {
    const { service, pipelines } = buildService({ rows: [] });

    const result = await service.fetchCustomers(1, 5);

    expect(result.data).toEqual([]);
    expect(pipelines.some((p) => p.some((s) => s.$group?._id === '$customer'))).toBe(
      false,
    );
  });
});

describe('UserService.fetchCustomers — stat-card summary', () => {
  it('separates registered accounts from customers who have bought', async () => {
    const { service } = buildService({
      counts: [60, 60, 5, 4],
      distinct: [['c1', 'c2', 'c3'], ['c1'], ['c2', 'c3']],
    });

    const { summary } = await service.fetchCustomers(1, 5);

    expect(summary.total_customers).toBe(60);
    // "Unique" is the ones with orders, not the 60 registered accounts.
    expect(summary.unique_customers).toBe(3);
  });

  it('reports movement for both counted cards', async () => {
    const { service } = buildService({
      counts: [60, 60, 5, 4],
      distinct: [['c1', 'c2', 'c3'], ['c1'], ['c2', 'c3']],
    });

    const { summary } = await service.fetchCustomers(1, 5);

    expect(summary.changes.period_days).toBe(30);
    expect(summary.changes.total_customers).toBe(25);
    expect(summary.changes.unique_customers).toBe(-50);
  });

  it('counts distinct customers per location, not orders', async () => {
    // One customer ordering ten times must not make their state the busiest.
    const { service, pipelines } = buildService({
      topLocation: [{ _id: 'Lagos', count: 22 }],
    });

    const { summary } = await service.fetchCustomers(1, 5);

    expect(summary.top_location).toEqual({ label: 'Lagos', customers: 22 });
    const locationPipeline = pipelines.find((p) => p.some((s) => s.$group?.customers));
    const group = locationPipeline!.find((s) => s.$group)!.$group;
    expect(group.customers).toEqual({ $addToSet: '$customer' });
  });

  it('names the most-ordered product', async () => {
    const { service } = buildService({
      favourite: [{ name: 'Amasi Dress', totalOrdered: 9 }],
    });

    const { summary } = await service.fetchCustomers(1, 5);

    expect(summary.favourite_product).toEqual({ name: 'Amasi Dress', units: 9 });
  });

  it('reports null rather than naming a product nothing has bought', async () => {
    const { service } = buildService({
      favourite: [{ name: 'Amasi Dress', totalOrdered: 0 }],
    });

    const { summary } = await service.fetchCustomers(1, 5);
    expect(summary.favourite_product).toBeNull();
  });

  it('returns nulls, not a crash, on an empty marketplace', async () => {
    const { service } = buildService({});

    const { summary } = await service.fetchCustomers(1, 5);

    expect(summary.top_location).toBeNull();
    expect(summary.favourite_product).toBeNull();
    expect(summary.unique_customers).toBe(0);
  });

  it('is unfiltered, so the cards do not move as the table is searched', async () => {
    const { service, userQueries } = buildService({ counts: [3, 60, 5, 4] });

    await service.fetchCustomers(1, 5, { search: 'kennedy' });

    // The FIRST count is the paging total and must honour the search — a
    // filtered table showing "of 60" would be wrong. Every count after it
    // belongs to the summary and must not.
    expect(userQueries[0].$or).toBeDefined();
    for (const query of userQueries.slice(1)) {
      expect(query.$or).toBeUndefined();
      expect(query.type).toBe(UserType.CUSTOMER);
    }
  });
});

describe('UserService.setCustomerStatus', () => {
  const CUSTOMER = new Types.ObjectId().toString();

  const build = (updated: unknown, orders = 0) => {
    let filter: Record<string, any> | undefined;
    let update: Record<string, any> | undefined;

    const service = Object.create(UserService.prototype) as UserService;
    Object.assign(service, {
      userModel: {
        findOneAndUpdate: jest.fn((f: any, u: any) => {
          filter = f;
          update = u;
          return { lean: () => Promise.resolve(updated) };
        }),
        findOne: jest.fn(() => ({ lean: () => Promise.resolve(updated) })),
        deleteOne: jest.fn(() => Promise.resolve({ deletedCount: 1 })),
      },
      orderModel: { countDocuments: jest.fn(() => Promise.resolve(orders)) },
    });

    return { service, getFilter: () => filter, getUpdate: () => update };
  };

  it('rejects an id that is not an ObjectId', async () => {
    const { service } = build({});
    await expect(service.setCustomerStatus('nope', 'active')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('only ever touches a customer', async () => {
    // The users collection also holds vendors and platform staff; an admin
    // suspending a vendor through this route would be a foot-gun.
    const { service, getFilter } = build({ _id: CUSTOMER });

    await service.setCustomerStatus(CUSTOMER, 'suspended');

    expect(getFilter()!.type).toBe(UserType.CUSTOMER);
  });

  it('writes the requested state', async () => {
    const { service, getUpdate } = build({ _id: CUSTOMER });
    await service.setCustomerStatus(CUSTOMER, 'suspended');
    expect(getUpdate()).toEqual({ $set: { status: 'suspended' } });
  });

  it('404s when no customer matches', async () => {
    // Including when the id belongs to a vendor — the type filter excluded it.
    const { service } = build(null);
    await expect(
      service.setCustomerStatus(CUSTOMER, 'active'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('UserService.deleteCustomer', () => {
  const CUSTOMER = new Types.ObjectId().toString();

  const build = (customer: unknown, orders: number) => {
    const service = Object.create(UserService.prototype) as UserService;
    const deleteOne = jest.fn(() => Promise.resolve({ deletedCount: 1 }));
    Object.assign(service, {
      userModel: {
        findOne: jest.fn(() => ({ lean: () => Promise.resolve(customer) })),
        deleteOne,
      },
      orderModel: { countDocuments: jest.fn(() => Promise.resolve(orders)) },
    });
    return { service, deleteOne };
  };

  it('deletes a customer who never transacted', async () => {
    const { service, deleteOne } = build({ _id: CUSTOMER }, 0);

    await expect(service.deleteCustomer(CUSTOMER)).resolves.toEqual({
      deleted: true,
      id: CUSTOMER,
    });
    expect(deleteOne).toHaveBeenCalled();
  });

  it('refuses to delete a customer with orders', async () => {
    // Their buyer reference would dangle and every past order would render
    // unattributable, losing the revenue history's owner.
    const { service, deleteOne } = build({ _id: CUSTOMER }, 3);

    await expect(service.deleteCustomer(CUSTOMER)).rejects.toThrow(
      ConflictException,
    );
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('says how many orders, and what to do instead', async () => {
    const { service } = build({ _id: CUSTOMER }, 3);

    await expect(service.deleteCustomer(CUSTOMER)).rejects.toThrow(
      /3 orders.*suspend the account instead/i,
    );
  });

  it('gets the singular right for one order', async () => {
    const { service } = build({ _id: CUSTOMER }, 1);
    await expect(service.deleteCustomer(CUSTOMER)).rejects.toThrow(/1 order\b/);
  });

  it('404s for an unknown customer', async () => {
    const { service } = build(null, 0);
    await expect(service.deleteCustomer(CUSTOMER)).rejects.toThrow(
      NotFoundException,
    );
  });
});
