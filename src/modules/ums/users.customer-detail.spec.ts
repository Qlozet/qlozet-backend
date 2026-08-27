import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserService } from './services/users.service';
import { UserType } from './schemas';

/**
 * getCustomerDetail() backs the admin console's customer detail header, which
 * used to be a mix of hard-coded figures and fields the console guessed the
 * spelling of.
 *
 * Two things are worth pinning down here and nothing else really is: that every
 * one of the eight reads is scoped to the ONE customer (an unscoped $match
 * would put marketplace-wide totals on a page about a person, and it would look
 * plausible), and that an absent wallet or token record reads as 0 rather than
 * null — a customer who never topped up has a zero balance, and a null renders
 * as a dash that claims the balance is unknown.
 *
 * The service constructor pulls in mail, logistics and size-guide collaborators
 * none of this touches, so the models are attached to a bare instance.
 */
type Pipeline = Record<string, any>[];

const CUSTOMER = '6a4a085a4ba435c95283926c';

const chain = (result: unknown) => {
  const self: any = {
    sort: () => self,
    select: () => self,
    lean: () => Promise.resolve(result),
  };
  return self;
};

const buildService = (
  overrides: {
    customer?: Record<string, unknown> | null;
    orderStats?: Record<string, unknown>[];
    address?: Record<string, unknown> | null;
    wallet?: Record<string, unknown> | null;
    token?: Record<string, unknown> | null;
    reservations?: number;
    reviews?: Record<string, unknown>[];
  } = {},
) => {
  const orderPipelines: Pipeline[] = [];
  const productPipelines: Pipeline[] = [];
  const filters: Record<string, unknown[]> = {
    user: [],
    address: [],
    wallet: [],
    token: [],
    reservation: [],
  };

  const customer =
    overrides.customer === undefined
      ? {
          _id: new Types.ObjectId(CUSTOMER),
          full_name: 'John Doe',
          email: 'customer@example.com',
          status: 'active',
          following_businesses: [
            new Types.ObjectId(),
            new Types.ObjectId(),
            new Types.ObjectId(),
          ],
        }
      : overrides.customer;

  const service = Object.create(UserService.prototype) as UserService;

  Object.assign(service, {
    userModel: {
      findOne: jest.fn((filter: Record<string, unknown>) => {
        filters.user.push(filter);
        return chain(customer);
      }),
    },
    orderModel: {
      aggregate: jest.fn((pipeline: Pipeline) => {
        orderPipelines.push(pipeline);
        return Promise.resolve(overrides.orderStats ?? []);
      }),
    },
    addressModel: {
      findOne: jest.fn((filter: unknown) => {
        filters.address.push(filter);
        return chain(overrides.address ?? null);
      }),
    },
    walletModel: {
      findOne: jest.fn((filter: unknown) => {
        filters.wallet.push(filter);
        return chain(overrides.wallet ?? null);
      }),
    },
    tokenModel: {
      findOne: jest.fn((filter: unknown) => {
        filters.token.push(filter);
        return chain(overrides.token ?? null);
      }),
    },
    fabricReservationModel: {
      countDocuments: jest.fn((filter: unknown) => {
        filters.reservation.push(filter);
        return Promise.resolve(overrides.reservations ?? 0);
      }),
    },
    productModel: {
      aggregate: jest.fn((pipeline: Pipeline) => {
        productPipelines.push(pipeline);
        return Promise.resolve(overrides.reviews ?? []);
      }),
    },
  });

  return { service, orderPipelines, productPipelines, filters };
};

const stageOf = (pipeline: Pipeline, key: string): Record<string, any> =>
  pipeline.find((stage) => stage[key])?.[key] ?? {};

describe('UserService.getCustomerDetail — the id', () => {
  it('404s on an id that is not an ObjectId instead of letting the cast blow up as a 500', async () => {
    const { service, filters } = buildService();

    await expect(service.getCustomerDetail('not-an-id')).rejects.toThrow(
      NotFoundException,
    );
    // Nothing should have been queried at all.
    expect(filters.user).toHaveLength(0);
  });

  it('404s when no customer matches', async () => {
    const { service } = buildService({ customer: null });

    await expect(service.getCustomerDetail(CUSTOMER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('looks the person up as a customer, not as any user', async () => {
    // The users collection also holds vendors and platform staff; an admin
    // opening /admin/customer/<a vendor's id> should get a 404, not a header
    // full of a vendor's figures.
    const { service, filters } = buildService();

    await service.getCustomerDetail(CUSTOMER);

    expect(filters.user[0]).toMatchObject({ type: UserType.CUSTOMER });
    expect(String((filters.user[0] as any)._id)).toBe(CUSTOMER);
  });
});

describe('UserService.getCustomerDetail — query scoping', () => {
  it('scopes every one of the six side lookups to this customer', async () => {
    const { service, orderPipelines, productPipelines, filters } =
      buildService();

    await service.getCustomerDetail(CUSTOMER);

    expect(String(stageOf(orderPipelines[0], '$match').customer)).toBe(
      CUSTOMER,
    );
    // Ratings live embedded in products.ratings[]; the match is on the author.
    expect(String(stageOf(productPipelines[0], '$match')['ratings.user'])).toBe(
      CUSTOMER,
    );
    expect(String((filters.wallet[0] as any).customer)).toBe(CUSTOMER);
    expect(String((filters.token[0] as any).customer)).toBe(CUSTOMER);
    expect(String((filters.reservation[0] as any).organizer)).toBe(CUSTOMER);
    // Addresses are matched through the service's own legacy-tolerant filter,
    // which compares the ref as a string.
    expect(JSON.stringify(filters.address[0])).toContain(CUSTOMER);
  });

  it('counts only the rating entries this customer authored, not the whole product', async () => {
    const { service, productPipelines } = buildService();

    await service.getCustomerDetail(CUSTOMER);

    // A product can carry twenty ratings from twenty people. $size over the
    // raw array would credit all of them to this one customer.
    const project = stageOf(productPipelines[0], '$project');
    expect(project.authored.$size.$filter.cond).toEqual({
      $eq: ['$$rating.user', new Types.ObjectId(CUSTOMER)],
    });
  });

  it('counts spend against paid orders and returns against refunded ones', async () => {
    const { service, orderPipelines } = buildService();

    await service.getCustomerDetail(CUSTOMER);

    const group = stageOf(orderPipelines[0], '$group');
    // An unpaid, abandoned order must not inflate lifetime spend.
    expect(group.lifetime_spending.$sum.$cond[0]).toEqual({
      $eq: ['$payment_status', 'paid'],
    });
    expect(group.total_returns.$sum.$cond[0]).toEqual({
      $in: ['$refund_status', ['partial', 'refunded']],
    });
    expect(group.total_orders).toEqual({ $sum: 1 });
    expect(group.last_order_at).toEqual({ $max: '$createdAt' });
  });
});

describe('UserService.getCustomerDetail — absent records read as 0', () => {
  it('gives a customer with no wallet, no token and no orders zeroes, never nulls', async () => {
    const { service } = buildService({
      wallet: null,
      token: null,
      orderStats: [],
      reviews: [],
      reservations: 0,
    });

    const detail = await service.getCustomerDetail(CUSTOMER);

    // 0, not null: they have a zero balance and no orders, which is a fact
    // about them. The console renders null as a dash — "unknown" — instead.
    expect(detail.wallet_balance).toBe(0);
    expect(detail.pending_balance).toBe(0);
    expect(detail.token_balance).toBe(0);
    expect(detail.total_orders).toBe(0);
    expect(detail.lifetime_spending).toBe(0);
    expect(detail.total_returns).toBe(0);
    expect(detail.reviews_count).toBe(0);
    expect(detail.reserved_fabrics).toBe(0);

    for (const key of [
      'wallet_balance',
      'pending_balance',
      'token_balance',
      'total_orders',
      'lifetime_spending',
      'total_returns',
      'reviews_count',
      'reserved_fabrics',
      'followed_vendors',
    ] as const) {
      expect(typeof detail[key]).toBe('number');
    }

    // No orders means no last order — that one genuinely has no source.
    expect(detail.last_order_at).toBeNull();
  });

  it('passes real balances and totals straight through', async () => {
    const { service } = buildService({
      wallet: { balance: 25000, pending_balance: 0 },
      token: { tokens: 120 },
      reservations: 1,
      reviews: [{ reviews_count: 20 }],
      orderStats: [
        {
          total_orders: 14,
          last_order_at: new Date('2026-08-15T09:31:00.000Z'),
          lifetime_spending: 486000,
          total_returns: 4500,
        },
      ],
    });

    const detail = await service.getCustomerDetail(CUSTOMER);

    expect(detail.total_orders).toBe(14);
    expect(detail.lifetime_spending).toBe(486000);
    expect(detail.total_returns).toBe(4500);
    expect(detail.wallet_balance).toBe(25000);
    expect(detail.token_balance).toBe(120);
    expect(detail.reviews_count).toBe(20);
    expect(detail.reserved_fabrics).toBe(1);
    expect(detail.followed_vendors).toBe(3);
    expect(detail.last_order_at).toEqual(new Date('2026-08-15T09:31:00.000Z'));
  });
});

describe('UserService.getCustomerDetail — derived profile fields', () => {
  it('builds location from the default address and keeps address an object', async () => {
    const { service } = buildService({
      address: { city: 'Ikeja', state: 'Lagos' },
    });

    const detail = await service.getCustomerDetail(CUSTOMER);

    expect(detail.address).toEqual({ city: 'Ikeja', state: 'Lagos' });
    expect(detail.location).toBe('Ikeja, Lagos');
  });

  it('nulls location when there is no address, without nulling the object itself', async () => {
    const { service } = buildService({ address: null });

    const detail = await service.getCustomerDetail(CUSTOMER);

    // The console reads `address.state` unguarded, so the object survives.
    expect(detail.address).toEqual({ city: null, state: null });
    expect(detail.location).toBeNull();
  });

  it('splits full_name rather than inventing a first and last name', async () => {
    const { service } = buildService();

    const detail = await service.getCustomerDetail(CUSTOMER);

    expect(detail.first_name).toBe('John');
    expect(detail.last_name).toBe('Doe');
    expect(detail.full_name).toBe('John Doe');
  });

  it('leaves last_name null for a single-word name', async () => {
    const { service } = buildService({
      customer: {
        _id: new Types.ObjectId(CUSTOMER),
        full_name: 'Chinelo',
        email: 'c@example.com',
        status: 'active',
      },
    });

    const detail = await service.getCustomerDetail(CUSTOMER);

    expect(detail.first_name).toBe('Chinelo');
    expect(detail.last_name).toBeNull();
  });

  it('exposes phone_number as phone and surfaces last_login_at', async () => {
    const signedInAt = new Date('2026-08-26T09:12:00.000Z');
    const { service } = buildService({
      customer: {
        _id: new Types.ObjectId(CUSTOMER),
        full_name: 'John Doe',
        email: 'customer@example.com',
        status: 'active',
        phone_number: '+2348148972345',
        last_login_at: signedInAt,
      },
    });

    const detail = await service.getCustomerDetail(CUSTOMER);

    expect(detail.phone).toBe('+2348148972345');
    expect(detail.last_login_at).toEqual(signedInAt);
  });

  it('nulls last_login_at for an account that predates the field', async () => {
    const { service } = buildService();

    const detail = await service.getCustomerDetail(CUSTOMER);

    expect(detail.last_login_at).toBeNull();
  });
});
