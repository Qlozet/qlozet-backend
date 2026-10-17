import { ForbiddenException } from '@nestjs/common';
import { ConsoleAccessGuard, PASSWORD_CHANGE_REQUIRED } from './console-access.guard';
import { platformRoleVerdict } from './roles.guard';

/**
 * The guard that makes the Edit Access grid real. Super admins and admins
 * pass; every other staff role is held to its grid; customers and vendors
 * are only kept out of the console's own routes.
 */

const lean = (v: unknown) => {
  const q: any = { select: () => q, populate: () => q, lean: () => Promise.resolve(v) };
  return q;
};

const build = (user: any, role?: any) => {
  const guard = new ConsoleAccessGuard(
    { getAllAndOverride: () => false } as any,
    { findById: jest.fn(() => lean(user)) } as any,
    { findById: jest.fn(() => lean(role ?? null)) } as any,
  );
  const run = (method: string, url: string, userId = 'u1') => {
    const request: any = { method, originalUrl: url, user: { id: userId } };
    const context: any = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    };
    return guard.canActivate(context).then((ok) => ({ ok, request }));
  };
  return { run };
};

const staff = (patch: Record<string, unknown> = {}) => ({
  type: 'platform',
  status: 'active',
  role: 'r1',
  must_change_password: false,
  ...patch,
});

const role = (name: string, ...perms: string[]) => ({
  name,
  permissions: perms.map((p) => ({ name: p })),
});

describe('ConsoleAccessGuard', () => {
  it('leaves customers and vendors alone outside the console', async () => {
    const { run } = build({ type: 'customer' });
    await expect(run('GET', '/api/products')).resolves.toMatchObject({ ok: true });
    await expect(run('POST', '/api/orders')).resolves.toMatchObject({ ok: true });
  });

  it('keeps customers and vendors out of /admin and the staff user routes', async () => {
    const { run } = build({ type: 'vendor' });
    await expect(run('GET', '/api/admin/dashboard')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run('DELETE', '/api/admin/customer/abc')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run('GET', '/api/users/admins')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a deactivated staff account everywhere', async () => {
    const { run } = build(staff({ status: 'inactive' }), role('admin'));
    await expect(run('GET', '/api/users/me')).rejects.toThrow(/deactivated/);
  });

  it('holds everything but the password routes while a temporary password is in use', async () => {
    const { run } = build(staff({ must_change_password: true }), role('super_admin'));
    await expect(run('GET', '/api/admin/dashboard')).rejects.toMatchObject({
      response: { code: PASSWORD_CHANGE_REQUIRED },
    });
    await expect(run('POST', '/api/auth/change-password')).resolves.toMatchObject({ ok: true });
    await expect(run('GET', '/api/users/me/access')).resolves.toMatchObject({ ok: true });
  });

  it('super admins and admins pass without consulting the grid', async () => {
    for (const name of ['super_admin', 'admin']) {
      const { run } = build(staff(), role(name));
      const out = await run('DELETE', '/api/admin/customer/abc');
      expect(out.ok).toBe(true);
      expect(out.request.consoleAccess).toMatchObject({ roleName: name, fullAccess: true });
    }
  });

  it('every other staff role is held to its grid cell', async () => {
    const { run } = build(staff(), role('customer_support', 'customers.view', 'tickets.view', 'tickets.edit'));
    await expect(run('GET', '/api/admin/customer/abc')).resolves.toMatchObject({ ok: true });
    await expect(run('POST', '/api/admin/t1/reply')).resolves.toMatchObject({ ok: true });
    // Reading vendors, and anything in admin management, is not granted.
    await expect(run('GET', '/api/admin/businesses')).rejects.toThrow(
      'Your role (customer support) cannot view Vendors.',
    );
    await expect(run('GET', '/api/users/admins')).rejects.toBeInstanceOf(ForbiddenException);
    // Approving a vendor is editing vendors, whatever the method says.
    await expect(run('POST', '/api/admin/abc/approve')).rejects.toThrow(/change Vendors/);
  });

  it('routes the grid does not cover stay open to staff', async () => {
    const { run } = build(staff(), role('sales', 'dashboard.view'));
    await expect(run('GET', '/api/users/me')).resolves.toMatchObject({ ok: true });
    await expect(run('GET', '/api/notifications')).resolves.toMatchObject({ ok: true });
  });

  it('a staff account with no role is refused with a reason', async () => {
    const { run } = build(staff({ role: null }));
    await expect(run('GET', '/api/admin/dashboard')).rejects.toThrow(/No role is assigned/);
  });
});

describe('platformRoleVerdict (the roles guard, for staff)', () => {
  it('a super admin passes everything', () => {
    expect(platformRoleVerdict('super_admin', ['super_admin'])).toBe('allow');
    expect(platformRoleVerdict('super_admin', ['vendor'])).toBe('allow');
  });

  it('a route that names only the super admin stays theirs, even for admins', () => {
    expect(platformRoleVerdict('admin', ['super_admin'])).toBe('super_admin_only');
    expect(platformRoleVerdict('operations', ['super_admin'])).toBe('super_admin_only');
  });

  it('any route open to staff passes any staff role; the grid decides the rest', () => {
    expect(platformRoleVerdict('operations', ['admin', 'super_admin'])).toBe('allow');
    expect(platformRoleVerdict('customer_support', ['platform'])).toBe('allow');
    expect(platformRoleVerdict('finance', ['vendor', 'admin', 'super_admin'])).toBe('allow');
  });

  it('a route for vendors or customers only is not for staff', () => {
    expect(platformRoleVerdict('admin', ['vendor'])).toBe('not_for_staff');
    expect(platformRoleVerdict('operations', ['customer'])).toBe('not_for_staff');
  });
});
