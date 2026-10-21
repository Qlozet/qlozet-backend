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

    it('moves a deactivated member off the store they have open', async () => {
      const { service, userUpdates } = makeService({
        member: { _id: memberId, user: 'u1', business: 'b1', is_owner: false },
        user: { _id: 'u1', business: 'b1' },
        nextMembership: { business: 'b2' },
      });
      await service.updateMember(memberId, 'b1', { is_active: false });
      expect(userUpdates).toEqual([{ business: 'b2' }]);
    });

    it('resends a fresh temporary password to a member still on the first one', async () => {
      const user = { _id: 'u1', must_change_password: true, hashed_password: 'old', save: jest.fn() };
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
      expect(sent[0].slice(0, 4)).toEqual(['tolu@example.com', 'Tolu', 'operations', 'Ada Couture']);
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
