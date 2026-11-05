import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserType } from '../ums/schemas/user.schema';

/**
 * One person, one email, a shopping account and a store account
 * (linked-accounts.ts): opening one from the other, signing in across, and
 * one password for both.
 */
describe('linked shop and store accounts', () => {
  const session: any = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(async () => undefined),
    abortTransaction: jest.fn(async () => undefined),
    endSession: jest.fn(),
  };

  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('ShopPass1', 4);
  });

  /** A query that can be chained (.select/.sort/.session) or awaited. */
  const q = (value: any) => {
    const query: any = {
      select: () => query,
      sort: () => query,
      session: () => query,
      exec: async () => value,
      then: (res: any, rej: any) => Promise.resolve(value).then(res, rej),
    };
    return query;
  };

  const build = (users: any[]) => {
    const created: any[] = [];
    const service = Object.create(AuthService.prototype) as any;
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.connection = { startSession: async () => session };
    const matches = (u: any, f: any) =>
      Object.entries(f).every(([k, v]: [string, any]) => {
        if (v && typeof v === 'object' && '$ne' in v) return u[k] !== v.$ne;
        if (v && typeof v === 'object' && '$in' in v)
          return v.$in.includes(u[k]);
        return u[k] === v;
      });
    service.userModel = {
      find: jest.fn((f: any) => q(users.filter((u) => matches(u, f)))),
      findOne: jest.fn((f: any) => q(users.find((u) => matches(u, f)) ?? null)),
      findById: jest.fn((id: any) =>
        q(users.find((u) => String(u._id) === String(id)) ?? null),
      ),
      exists: jest.fn(async (f: any) =>
        users.some((u) => matches(u, f)) ? { _id: 'x' } : null,
      ),
      create: jest.fn(async (docs: any[]) => {
        const doc = {
          ...docs[0],
          _id: new Types.ObjectId(),
          toObject() {
            return { ...this };
          },
        };
        users.push(doc);
        created.push(doc);
        return [doc];
      }),
      updateOne: jest.fn(() => q({})),
      updateMany: jest.fn(async (f: any, u: any) => {
        const hit = users.filter((x) => matches(x, f));
        hit.forEach((x) => {
          Object.assign(x, u.$set ?? {});
          Object.keys(u.$unset ?? {}).forEach((k) => delete x[k]);
        });
        return { modifiedCount: hit.length };
      }),
      findByIdAndUpdate: jest.fn(async () => undefined),
    };
    service.roleModel = { findOne: jest.fn(async () => ({ _id: 'role' })) };
    service.businessModel = {
      findOne: jest.fn(async () => null),
      create: jest.fn(async (docs: any[]) => [
        { ...docs[0], _id: new Types.ObjectId() },
      ]),
      findByIdAndUpdate: jest.fn(async () => undefined),
    };
    service.teamMemberModel = {
      create: jest.fn(async () => [{ _id: new Types.ObjectId() }]),
    };
    service.walletModel = { create: jest.fn(async () => [{}]) };
    service.tokenModel = { create: jest.fn(async () => [{}]) };
    service.platformSettingsModel = {
      findOne: () => ({ lean: async () => ({}) }),
    };
    service.notificationsService = {
      notifyPlatformAdmins: jest.fn(),
      create: jest.fn(async () => undefined),
    };
    service.mailService = {
      sendVerificationEmail: jest.fn(async () => undefined),
      sendVendorWelcomeEmail: jest.fn(async () => undefined),
      sendCustomerWelcomeEmail: jest.fn(async () => undefined),
      sendPasswordResetSuccessEmail: jest.fn(async () => undefined),
    };
    service.generateToken = jest.fn(async () => ({
      access_token: 'a',
      refresh_token: 'r',
    }));
    return { service, created, users };
  };

  const shopper = (over: Record<string, any> = {}): any => ({
    _id: new Types.ObjectId(),
    email: 'ada@example.com',
    full_name: 'Ada Obi',
    phone_number: '+2348031234567',
    type: UserType.CUSTOMER,
    status: 'active',
    email_verified: true,
    hashed_password: hash,
    ...over,
  });

  const signup = (password = 'ShopPass1') => ({
    business_name: 'Ada Couture',
    personal_name: 'Ada Obi',
    personal_email: 'ada@example.com',
    personal_phone_number: '+2348031234567',
    password,
  });

  describe('store sign-up with a shopping email', () => {
    it('opens the store at once with the shop password, no code', async () => {
      const { service, created } = build([shopper()]);
      const res = await service.registerVendor(signup());

      const vendor = created.find((u) => u.type === UserType.VENDOR);
      expect(vendor.email).toBe('ada@example.com');
      // Same number is fine: it only has to be unique among stores.
      expect(vendor.phone_number).toBe('+2348031234567');
      expect(vendor.email_verified).toBe(true);
      expect(vendor.email_verification_token).toBeUndefined();
      expect(service.mailService.sendVerificationEmail).not.toHaveBeenCalled();
      expect(res.data.token.access_token).toBe('a');
      expect(res.data.linked_shop_account).toBe(true);
    });

    it('refuses a different password, with the way forward', async () => {
      const { service, created } = build([shopper()]);
      await expect(service.registerVendor(signup('Other1234'))).rejects.toThrow(
        /shop password/,
      );
      expect(created).toHaveLength(0);
    });

    it('sends a code when the shopper signed up with Google', async () => {
      const { service, created } = build([
        shopper({ hashed_password: undefined }),
      ]);
      const res = await service.registerVendor(signup());
      const vendor = created.find((u) => u.type === UserType.VENDOR);
      expect(vendor.email_verified).toBe(false);
      expect(service.mailService.sendVerificationEmail).toHaveBeenCalled();
      expect(res.data.token).toBeUndefined();
    });

    it('still refuses a number another store has', async () => {
      const { service } = build([
        shopper({ email: 'other@example.com', type: UserType.VENDOR }),
      ]);
      await expect(service.registerVendor(signup())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('frees a number held by an unverified sign-up on another email', async () => {
      const abandoned = shopper({
        email: 'ada@exmaple.com', // the typo
        type: UserType.VENDOR,
        email_verified: false,
      });
      const { service, created } = build([abandoned]);
      await service.registerVendor(signup());
      expect(abandoned.phone_number).toBeUndefined();
      expect(abandoned.email).toBe('ada@exmaple.com'); // kept, just no number
      expect(created.find((u) => u.type === UserType.VENDOR).phone_number).toBe(
        '+2348031234567',
      );
    });

    it('never links to a staff email', async () => {
      const { service } = build([shopper({ type: UserType.PLATFORM })]);
      await expect(service.registerVendor(signup())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('opening a store from the shop', () => {
    it('makes the store account on the same email, number and password', async () => {
      const me = shopper();
      const { service, created } = build([me]);
      const res = await service.openStoreForCustomer(String(me._id), {
        business_name: 'Ada Couture',
      });
      const vendor = created.find((u) => u.type === UserType.VENDOR);
      expect(vendor.hashed_password).toBe(hash);
      expect(vendor.phone_number).toBe(me.phone_number);
      expect(vendor.email_verified).toBe(true);
      expect(res.data.vendor_login_url).toContain('email=ada%40example.com');
    });

    it('asks a Google shopper to set a password', async () => {
      const me = shopper({ hashed_password: undefined });
      const { service } = build([me]);
      await expect(
        service.openStoreForCustomer(String(me._id), {
          business_name: 'Ada Couture',
        }),
      ).rejects.toThrow(/Set a password/);
    });

    it('refuses a second store account', async () => {
      const me = shopper();
      const { service } = build([me, shopper({ type: UserType.VENDOR })]);
      await expect(
        service.openStoreForCustomer(String(me._id), {
          business_name: 'Ada Couture',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('signing in across', () => {
    it('a store owner signing in on the shop gets a shopping account', async () => {
      const { service, created } = build([shopper({ type: UserType.VENDOR })]);
      const res = await service.loginCustomer('ada@example.com', 'ShopPass1');
      const customer = created.find((u) => u.type === UserType.CUSTOMER);
      expect(customer.hashed_password).toBe(hash);
      expect(customer.email_verified).toBe(true);
      expect(service.walletModel.create).toHaveBeenCalled();
      expect(res.data.token.access_token).toBe('a');
    });

    it('a wrong password makes nothing', async () => {
      const { service, created } = build([shopper({ type: UserType.VENDOR })]);
      await expect(
        service.loginCustomer('ada@example.com', 'Wrong1234'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(created).toHaveLength(0);
    });

    it('an unverified store makes nothing', async () => {
      const { service, created } = build([
        shopper({ type: UserType.VENDOR, email_verified: false }),
      ]);
      await expect(
        service.loginCustomer('ada@example.com', 'ShopPass1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(created).toHaveLength(0);
    });

    it('a shopper on the vendor app is told to sign up for a store', async () => {
      const { service } = build([shopper()]);
      await expect(
        service.loginVendor('ada@example.com', 'ShopPass1'),
      ).rejects.toThrow(/don't have a store yet/);
    });

    it('a wrong password on the vendor app says only "invalid"', async () => {
      const { service } = build([shopper()]);
      await expect(
        service.loginVendor('ada@example.com', 'Wrong1234'),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  it('one password: a reset on one account changes the other', async () => {
    const shop = shopper();
    const store = shopper({ type: UserType.VENDOR });
    const staff = shopper({
      type: UserType.PLATFORM,
      email: 'ada@example.com',
    });
    const { service } = build([shop, store, staff]);
    shop.save = jest.fn(async () => shop);
    service.assertResetCode = jest.fn(async () => shop);

    await service.resetPassword('ada@example.com', '123456', 'NewPass12');

    expect(store.hashed_password).toBe(shop.hashed_password);
    expect(store.hashed_password).not.toBe(hash);
    // Staff never share it.
    expect(staff.hashed_password).toBe(hash);
  });
});

describe('swapping the old global indexes', () => {
  const { LinkedAccountsIndexMigration } = require('./linked-accounts');

  const collectionWith = (names: string[], failBuild: string[] = []) => {
    const present = new Set(names);
    return {
      present,
      createIndex: jest.fn(async (_k: any, o: any) => {
        if (failBuild.includes(o.name)) throw new Error('E11000 duplicate');
        present.add(o.name);
      }),
      indexes: jest.fn(async () => [...present].map((name) => ({ name }))),
      dropIndex: jest.fn(async (n: string) => {
        present.delete(n);
      }),
    };
  };

  it('drops email_1 even when the phone index cannot be built', async () => {
    const users = collectionWith(
      ['_id_', 'email_1', 'phone_number_1'],
      ['phone_type_unique'],
    );
    await new LinkedAccountsIndexMigration({ collection: users }).run();
    expect(users.present.has('email_1')).toBe(false);
    expect(users.present.has('email_type_unique')).toBe(true);
    // No replacement, so the old phone rule stays rather than leaving none.
    expect(users.present.has('phone_number_1')).toBe(true);
  });

  it('does nothing once swapped', async () => {
    const users = collectionWith([
      '_id_',
      'email_type_unique',
      'phone_type_unique',
    ]);
    await new LinkedAccountsIndexMigration({ collection: users }).run();
    expect(users.dropIndex).not.toHaveBeenCalled();
  });
});
