import { Types } from 'mongoose';
import { VendorRecipientsService } from './vendor-recipients.service';
import { VendorRole } from '../ums/schemas/role.schema';

/**
 * Who at a vendor hears about something.
 *
 * Four features used to answer this with `business.created_by`, which is one
 * person — the account that signed the business up. A tailor on the team was
 * unreachable by all four. These cover the rules that replaced it.
 */
describe('Vendor notification recipients', () => {
  const BUSINESS = new Types.ObjectId();

  const OWNER_ROLE = { _id: new Types.ObjectId(), name: 'owner' };
  const TAILOR_ROLE = { _id: new Types.ObjectId(), name: 'tailor' };
  const SUPPORT_ROLE = { _id: new Types.ObjectId(), name: 'customer_support' };
  const OPS_ROLE = { _id: new Types.ObjectId(), name: 'Operations' };

  const OWNER_USER = new Types.ObjectId();
  const TAILOR_USER = new Types.ObjectId();
  const SUPPORT_USER = new Types.ObjectId();

  let roleModel: any;
  let teamMemberModel: any;
  let service: VendorRecipientsService;
  let members: any[];

  const member = (overrides: any = {}) => ({
    business: BUSINESS,
    user: TAILOR_USER,
    role: TAILOR_ROLE,
    email: 'tailor@example.com',
    full_name: 'Bisi',
    is_active: true,
    accepted: true,
    is_owner: false,
    ...overrides,
  });

  beforeEach(() => {
    members = [
      member({
        user: OWNER_USER,
        role: OWNER_ROLE,
        email: 'owner@example.com',
        full_name: 'Ibidun',
        is_owner: true,
      }),
      member(),
      member({
        user: SUPPORT_USER,
        role: SUPPORT_ROLE,
        email: 'support@example.com',
        full_name: 'Chidi',
      }),
    ];

    roleModel = {
      find: () => ({
        lean: () =>
          Promise.resolve([OWNER_ROLE, TAILOR_ROLE, SUPPORT_ROLE, OPS_ROLE]),
      }),
    };

    // The query filter is captured so the conditions can be asserted; the
    // returned rows are filtered by role here to stand in for Mongo.
    teamMemberModel = {
      lastFilter: null as any,
      find(filter: any) {
        teamMemberModel.lastFilter = filter;
        const ids = (filter.role?.$in ?? []).map(String);
        const rows = members.filter(
          (m) =>
            ids.includes(String(m.role._id)) &&
            m.is_active &&
            m.accepted &&
            m.user,
        );
        return { populate: () => ({ lean: () => Promise.resolve(rows) }) };
      },
    };

    service = new VendorRecipientsService(teamMemberModel, roleModel);
  });

  const idsOf = (rows: { userId: string }[]) => rows.map((r) => r.userId).sort();

  it('includes a tailor on the team, which is the whole point', async () => {
    const rows = await service.resolve(BUSINESS, [VendorRole.TAILOR]);
    expect(idsOf(rows)).toEqual(
      [String(OWNER_USER), String(TAILOR_USER)].sort(),
    );
  });

  it('always includes the owner, even when they were not asked for', async () => {
    // Nobody should be able to configure their way out of hearing about
    // their own business.
    const rows = await service.resolve(BUSINESS, [VendorRole.TAILOR]);
    expect(rows.some((r) => r.userId === String(OWNER_USER))).toBe(true);
    expect(rows.find((r) => r.userId === String(OWNER_USER))?.isOwner).toBe(
      true,
    );
  });

  it('leaves out roles that were not asked for', async () => {
    const rows = await service.resolve(BUSINESS, [VendorRole.TAILOR]);
    expect(rows.some((r) => r.userId === String(SUPPORT_USER))).toBe(false);
  });

  it('matches a role name whatever its casing', async () => {
    // Seeded role documents are not guaranteed lower case — the guard
    // lower-cases before comparing and so does this.
    const rows = await service.resolve(BUSINESS, [VendorRole.OPERATIONS]);
    const ids = (teamMemberModel.lastFilter.role.$in ?? []).map(String);
    expect(ids).toContain(String(OPS_ROLE._id));
    expect(idsOf(rows)).toEqual([String(OWNER_USER)]);
  });

  it('asks only for active, accepted members with a user account', async () => {
    await service.resolve(BUSINESS, [VendorRole.TAILOR]);
    const f = teamMemberModel.lastFilter;

    expect(f.is_active).toBe(true);
    // An invited member who has not accepted has no user yet, so there is
    // nobody to put a notification against.
    expect(f.accepted).toBe(true);
    expect(f.user).toEqual({ $ne: null });
    expect(f.business).toBeInstanceOf(Types.ObjectId);
  });

  it('casts the business id, which an ObjectId match needs', async () => {
    await service.resolve(String(BUSINESS), [VendorRole.TAILOR]);
    expect(String(teamMemberModel.lastFilter.business)).toBe(String(BUSINESS));
  });

  it('returns one row per person, not one per team record', async () => {
    // Someone can hold more than one membership row; two bell entries for one
    // event reads as a bug.
    members.push(member({ user: TAILOR_USER, role: SUPPORT_ROLE }));
    const rows = await service.resolve(BUSINESS, [
      VendorRole.TAILOR,
      VendorRole.CUSTOMER_SUPPORT,
    ]);
    expect(rows.filter((r) => r.userId === String(TAILOR_USER))).toHaveLength(
      1,
    );
  });

  it('carries the email and name the mail needs', async () => {
    const rows = await service.resolve(BUSINESS, [VendorRole.TAILOR]);
    const tailor = rows.find((r) => r.userId === String(TAILOR_USER));
    expect(tailor?.email).toBe('tailor@example.com');
    expect(tailor?.name).toBe('Bisi');
  });

  it('is empty for no business rather than throwing', async () => {
    await expect(service.resolve(null, [VendorRole.TAILOR])).resolves.toEqual(
      [],
    );
    await expect(
      service.resolve(undefined, [VendorRole.TAILOR]),
    ).resolves.toEqual([]);
  });

  it('is empty when the lookup fails, so the caller still completes', async () => {
    // Every caller is notifying as a side effect of real work. A lookup
    // failure must not fail the dispute or the message that triggered it.
    roleModel.find = () => ({
      lean: () => Promise.reject(new Error('mongo down')),
    });
    await expect(service.resolve(BUSINESS, [VendorRole.TAILOR])).resolves.toEqual(
      [],
    );
  });

  describe('owner()', () => {
    it('picks the owner out of the team', async () => {
      const owner = await service.owner(BUSINESS);
      expect(owner?.userId).toBe(String(OWNER_USER));
    });

    it('is null for a business with no team at all', async () => {
      members = [];
      await expect(service.owner(BUSINESS)).resolves.toBeNull();
    });
  });
});
