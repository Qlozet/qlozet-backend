import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TeamService } from './services/team.service';

/**
 * Deactivating a member must actually stop them working in the store, and an
 * owner can send a fresh temporary password to someone who never signed in.
 */
describe('vendor team access', () => {
  describe('RolesGuard and a deactivated member', () => {
    const userId = 'u1';
    const build = (member: Record<string, unknown>) => {
      const user = {
        _id: userId,
        type: 'vendor',
        business: { _id: 'b1', team_members: [{ user: userId, ...member }] },
      };
      const userModel: any = {
        findById: () => ({
          populate: () => ({ populate: () => ({ exec: async () => user }) }),
        }),
      };
      const reflector: any = {
        get: (key: string) => (key === 'roles' ? ['vendor'] : undefined),
      };
      const jwt: any = { verifyAsync: async () => ({ id: userId }) };
      const guard = new RolesGuard(reflector, jwt, userModel, {} as any);
      const request: any = { headers: { authorization: 'Bearer t' } };
      const ctx: any = {
        getHandler: () => null,
        switchToHttp: () => ({ getRequest: () => request }),
      };
      return { guard, ctx };
    };

    it('refuses a member the owner deactivated', async () => {
      const { guard, ctx } = build({ role: { name: 'operations' }, is_active: false });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an active member through', async () => {
      const { guard, ctx } = build({ role: { name: 'operations' }, is_active: true });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('holds a member still on the temporary password', async () => {
      const { guard, ctx } = build({ role: { name: 'operations' }, is_active: true });
      const userModel: any = (guard as any).userModel;
      const original = userModel.findById;
      userModel.findById = () => {
        const q = original();
        return {
          populate: () => ({
            populate: () => ({
              exec: async () => ({ ...(await q.populate().populate().exec()), must_change_password: true }),
            }),
          }),
        };
      };
      await expect(guard.canActivate(ctx)).rejects.toThrow(/Set your own password/);
    });

    it('never locks out the owner', async () => {
      const { guard, ctx } = build({ role: { name: 'owner' }, is_owner: true, is_active: false });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('TeamService', () => {
    const business: any = { id: 'b1', business_name: 'Ada Couture' };

    const makeService = (opts: {
      member: any;
      user?: any;
      nextMembership?: any;
    }) => {
      const userUpdates: any[] = [];
      const sent: any[] = [];
      const memberDoc = { ...opts.member, save: jest.fn(async () => undefined) };
      const teamMemberModel: any = {
        findOne: jest.fn((q: any) => {
          // The member lookup is scoped by _id; the "next store" lookup by user.
          if (q && q.user && q._id?.$ne) return Promise.resolve(opts.nextMembership ?? null);
          const result: any = Promise.resolve(memberDoc);
          result.populate = () => Promise.resolve(memberDoc);
          return result;
        }),
      };
      const userModel: any = {
        findById: jest.fn(async () => opts.user ?? null),
        findByIdAndUpdate: jest.fn(async (id: any, update: any) => {
          userUpdates.push(update);
        }),
      };
      const mail: any = {
        sendTeamInviteEmail: jest.fn(async (...args: any[]) => {
          sent.push(args);
          return true;
        }),
      };
      const service = new TeamService(
        teamMemberModel,
        userModel,
        {} as any,
        {} as any,
        {} as any,
        mail,
        {} as any,
        {} as any,
      );
      return { service, userUpdates, sent, memberDoc };
    };

    const memberId = '64b000000000000000000001';

    it('deactivating leaves their open store alone (the guard refuses them instead)', async () => {
      const { service, userUpdates, memberDoc } = makeService({
        member: { _id: memberId, user: 'u1', business: 'b1', is_owner: false },
        user: { _id: 'u1', business: 'b1' },
        nextMembership: { business: 'b2' },
      });
      await service.updateMember(memberId, 'b1', { is_active: false });
      // No silent switch to another store mid-session.
      expect(userUpdates).toEqual([]);
      expect(memberDoc.save).toHaveBeenCalled();
    });

    describe('roles an owner may hand out', () => {
      const withRole = (role: any) => {
        const { service } = makeService({ member: { _id: memberId, is_owner: false } });
        (service as any).roleModel = {
          findById: () => ({ session: async () => role }),
        };
        return service;
      };
      const roleId = '64b0000000000000000000aa';

      it('refuses the owner role', async () => {
        const service = withRole({ _id: roleId, name: 'owner', type: 'vendor' });
        await expect(service.updateMember(memberId, 'b1', { role: roleId })).rejects.toThrow(/one owner/);
      });

      it('refuses a staff role', async () => {
        const service = withRole({ _id: roleId, name: 'super_admin', type: 'platform' });
        await expect(service.updateMember(memberId, 'b1', { role: roleId })).rejects.toThrow(/team roles/);
      });

      it('accepts a vendor role', async () => {
        const service = withRole({ _id: roleId, name: 'tailor', type: 'vendor' });
        await expect(service.updateMember(memberId, 'b1', { role: roleId })).resolves.toBeTruthy();
      });
    });

    it("refuses a phone number that is on someone else's account, instead of adding them", async () => {
      const { service } = makeService({ member: { _id: memberId } });
      (service as any).roleModel = {
        findById: () => ({ session: async () => ({ _id: 'r', name: 'tailor', type: 'vendor' }) }),
      };
      (service as any).userModel = {
        find: () => ({ select: async () => [] }), // nobody with Ada's email yet
        findOne: async () => ({ _id: 'bola', email: 'bola@example.com', type: 'vendor' }),
      };
      await expect(
        service.inviteTeamMember(
          { email: 'ada@example.com', full_name: 'Ada', role: '64b0000000000000000000aa', phone_number: '+2348031234567' } as any,
          { id: 'owner' } as any,
          business,
        ),
      ).rejects.toThrow(/belongs to another Qlozet account/);
    });

    it('resends a fresh temporary password to a member still on the first one', async () => {
      const user = {
        _id: 'u1',
        email: 'tolu@account.com',
        must_change_password: true,
        hashed_password: 'old',
        save: jest.fn(),
      };
      const { service, sent } = makeService({
        member: {
          _id: memberId,
          user: 'u1',
          email: 'tolu@example.com',
          full_name: 'Tolu',
          role: { name: 'operations' },
          is_owner: false,
          is_active: true,
        },
        user,
      });
      await service.resendInvite(memberId, business);
      expect(user.hashed_password).not.toBe('old');
      expect(user.save).toHaveBeenCalled();
      // To the account's own inbox, never the team row's copy of an email.
      expect(sent[0].slice(0, 4)).toEqual(['tolu@account.com', 'Tolu', 'operations', 'Ada Couture']);
    });

    it('refuses to resend once the member has set their own password', async () => {
      const { service, sent } = makeService({
        member: { _id: memberId, user: 'u1', full_name: 'Tolu', is_owner: false, is_active: true },
        user: { _id: 'u1', must_change_password: false, save: jest.fn() },
      });
      await expect(service.resendInvite(memberId, business)).rejects.toBeInstanceOf(BadRequestException);
      expect(sent).toHaveLength(0);
    });

    it('refuses to resend to a deactivated member', async () => {
      const { service } = makeService({
        member: { _id: memberId, user: 'u1', full_name: 'Tolu', is_owner: false, is_active: false },
        user: { _id: 'u1', must_change_password: true, save: jest.fn() },
      });
      await expect(service.resendInvite(memberId, business)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
