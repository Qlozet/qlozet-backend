import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AdminsService } from './services/admins.service';
import { UserType } from './schemas';
import { RoleType } from './schemas/role.schema';

/**
 * The console's Admin Management screen.
 *
 * The service is instantiated bare (the constructor only wires models and the
 * mailer) so each test can hand it exactly the model behaviour it needs.
 */
const OTHER_ID = new Types.ObjectId();

const platformRole = (name: string, id = new Types.ObjectId()) => ({
  _id: id,
  name,
  type: RoleType.PLATFORM,
  description: `${name} role`,
});

const chain = (result: unknown) => {
  const self: any = {
    select: () => self,
    populate: () => self,
    sort: () => self,
    skip: () => self,
    limit: () => self,
    lean: () => Promise.resolve(result),
    exec: () => Promise.resolve(result),
    then: (resolve: any, reject: any) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return self;
};

const buildService = (overrides: {
  rows?: Record<string, unknown>[];
  count?: number;
  role?: Record<string, unknown> | null;
  admin?: Record<string, unknown> | null;
  clash?: Record<string, unknown> | null;
  superAdminsRemaining?: number;
} = {}) => {
  const findQueries: Record<string, any>[] = [];
  const created: Record<string, any>[] = [];
  const mails: unknown[][] = [];

  const service = Object.create(AdminsService.prototype) as AdminsService;

  Object.assign(service, {
    logger: { warn: jest.fn(), log: jest.fn() },
    userModel: {
      find: jest.fn((query: Record<string, any>) => {
        findQueries.push(query);
        return chain(overrides.rows ?? []);
      }),
      findOne: jest.fn((query: Record<string, any>) => {
        findQueries.push(query);
        // getAdminOr404 asks for a platform user by id; the create path asks
        // for an email / phone clash.
        if (query.type === UserType.PLATFORM) {
          return chain(overrides.admin ?? null);
        }
        return chain(overrides.clash ?? null);
      }),
      countDocuments: jest.fn(() =>
        Promise.resolve(overrides.superAdminsRemaining ?? overrides.count ?? 0),
      ),
      create: jest.fn((doc: Record<string, any>) => {
        created.push(doc);
        return Promise.resolve({ ...doc, _id: OTHER_ID });
      }),
    },
    roleModel: {
      findById: jest.fn(() => chain(overrides.role ?? null)),
      findOne: jest.fn(() => chain(overrides.role ?? null)),
      find: jest.fn(() => chain([{ _id: new Types.ObjectId() }])),
    },
    mailService: {
      sendAdminInviteEmail: jest.fn((...args: unknown[]) => {
        mails.push(args);
        return Promise.resolve(true);
      }),
    },
  });

  return { service, findQueries, created, mails };
};

describe('AdminsService.list', () => {
  it('lists platform users only — never vendors or customers', async () => {
    const { service, findQueries } = buildService({ rows: [], count: 0 });

    await service.list({});

    expect(findQueries[0]).toMatchObject({ type: UserType.PLATFORM });
  });

  it('searches name, email and phone, escaping the input', async () => {
    const { service, findQueries } = buildService();

    await service.list({ search: '+234.8' });

    const or = findQueries[0].$or as { [key: string]: RegExp }[];
    expect(or.map((clause) => Object.keys(clause)[0])).toEqual([
      'full_name',
      'email',
      'phone_number',
      'username',
    ]);
    // A "+" would otherwise be a quantifier with nothing to repeat, and "."
    // would match any character.
    expect(or[0].full_name.source).toBe('\\+234\\.8');
  });

  it('matches nothing when the role filter names a role that does not exist', async () => {
    const { service, findQueries } = buildService({ role: null });

    await service.list({ role: 'ghost' });

    // A missing role must not silently widen to "every admin".
    expect(findQueries[0].role).toBeInstanceOf(Types.ObjectId);
  });

  it('shapes a row down to what the table renders', async () => {
    const roleId = new Types.ObjectId();
    const { service } = buildService({
      rows: [
        {
          _id: OTHER_ID,
          full_name: 'Shola James',
          email: 'shola@mail.com',
          phone_number: '+2348123456789',
          status: 'active',
          role: platformRole('operations', roleId),
          createdAt: '2025-09-25T00:00:00.000Z',
        },
      ],
      count: 1,
    });

    const page = await service.list({});

    expect(page.data[0]).toMatchObject({
      full_name: 'Shola James',
      email: 'shola@mail.com',
      status: 'active',
      role_name: 'operations',
    });
    expect(page.data[0].role).toMatchObject({ name: 'operations' });
  });
});

describe('AdminsService.create', () => {
  it('creates a platform user with a hashed temporary password and emails it', async () => {
    const role = platformRole('marketing');
    const { service, created, mails } = buildService({
      role,
      clash: null,
      admin: {
        _id: OTHER_ID,
        full_name: 'Kiki Mordi',
        email: 'kiki@mail.com',
        status: 'active',
        role,
      },
    });

    await service.create(
      {
        full_name: 'Kiki Mordi',
        email: ' Kiki@Mail.com ',
        phone_number: '+2348123456789',
        role: String(role._id),
      },
      { full_name: 'Kennedy' },
    );

    expect(created[0]).toMatchObject({
      email: 'kiki@mail.com', // trimmed and lowercased to match sign-in
      type: UserType.PLATFORM,
      status: 'active',
      role: role._id,
      must_change_password: true,
    });
    expect(created[0].hashed_password).not.toContain('kiki');
    // The password is emailed, never returned in the response.
    expect(mails[0][3]).toEqual(expect.any(String));
  });

  it('refuses a vendor role — an administrator would not be able to use it', async () => {
    const { service } = buildService({
      role: { _id: new Types.ObjectId(), name: 'tailor', type: RoleType.VENDOR },
    });

    await expect(
      service.create({
        full_name: 'Kiki Mordi',
        email: 'kiki@mail.com',
        role: 'tailor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an email already in use, saying which field clashed', async () => {
    const { service } = buildService({
      role: platformRole('sales'),
      clash: { email: 'kiki@mail.com' },
    });

    await expect(
      service.create({
        full_name: 'Kiki Mordi',
        email: 'kiki@mail.com',
        role: 'sales',
      }),
    ).rejects.toThrow(/email address already exists/);
  });

  it('rejects an unknown role rather than creating a role-less admin', async () => {
    const { service } = buildService({ role: null });

    await expect(
      service.create({
        full_name: 'Kiki Mordi',
        email: 'kiki@mail.com',
        role: 'nobody',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AdminsService.update', () => {
  const adminDoc = (over: Record<string, unknown> = {}) => ({
    _id: OTHER_ID,
    full_name: 'Shola James',
    email: 'shola@mail.com',
    status: 'active',
    role: platformRole('super_admin'),
    save: jest.fn(() => Promise.resolve()),
    set: jest.fn(),
    deleteOne: jest.fn(() => Promise.resolve()),
    ...over,
  });

  it('refuses to change your own account status', async () => {
    const admin = adminDoc({ role: platformRole('operations') });
    const { service } = buildService({ admin });

    await expect(
      service.update(String(OTHER_ID), { status: 'inactive' }, String(OTHER_ID)),
    ).rejects.toThrow(/your own account status/);
  });

  it('refuses to deactivate the last active super admin', async () => {
    const { service } = buildService({
      admin: adminDoc(),
      superAdminsRemaining: 0,
    });

    await expect(
      service.update(String(OTHER_ID), { status: 'inactive' }, 'someone-else'),
    ).rejects.toThrow(/lock everyone out/);
  });

  it('allows deactivating a super admin while another active one remains', async () => {
    const admin = adminDoc();
    const { service } = buildService({ admin, superAdminsRemaining: 1 });

    await service.update(String(OTHER_ID), { status: 'inactive' }, 'someone-else');

    expect(admin.status).toBe('inactive');
    expect(admin.save).toHaveBeenCalled();
  });

  it('404s on an id that is not an ObjectId, rather than casting and 500ing', async () => {
    const { service } = buildService();

    await expect(service.update('not-an-id', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AdminsService.remove', () => {
  it('refuses to delete you', async () => {
    const admin = {
      _id: OTHER_ID,
      status: 'active',
      role: platformRole('operations'),
      deleteOne: jest.fn(),
    };
    const { service } = buildService({ admin });

    await expect(
      service.remove(String(OTHER_ID), String(OTHER_ID)),
    ).rejects.toThrow(/delete your own account/);
    expect(admin.deleteOne).not.toHaveBeenCalled();
  });
});
