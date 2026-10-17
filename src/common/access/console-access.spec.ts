import {
  deniedMessage,
  isConsoleOnlyPath,
  normalisePath,
  passwordChangeAllowed,
  permits,
  resolveConsoleCell,
} from './console-access';

/**
 * The permission grid's meaning on the wire: which cell a request needs.
 * A wrong row here either locks staff out of a screen their grid allows or
 * lets them into one it does not, so the mapping is pinned route by route.
 */
describe('resolveConsoleCell', () => {
  const cell = (method: string, path: string) =>
    resolveConsoleCell(method, normalisePath(path));

  it('strips the global prefix and the query string', () => {
    expect(normalisePath('/api/admin/businesses?page=2')).toBe('/admin/businesses');
    expect(normalisePath('/api')).toBe('/');
    expect(normalisePath('/admin/customer/')).toBe('/admin/customer');
  });

  it('reads the action from the method', () => {
    expect(cell('GET', '/api/admin/businesses')).toEqual({ resource: 'vendors', action: 'view' });
    expect(cell('PATCH', '/api/admin/businesses/abc')).toEqual({ resource: 'vendors', action: 'edit' });
    expect(cell('DELETE', '/api/admin/customer/abc')).toEqual({ resource: 'customers', action: 'delete' });
    expect(cell('POST', '/api/admin/businesses/abc/notes')).toEqual({ resource: 'vendors', action: 'create' });
  });

  it('treats a vendor decision as editing vendors, not creating', () => {
    for (const verb of ['approve', 'reject', 'verify', 'in-review', 'verification-decision']) {
      expect(cell('POST', `/api/admin/6a5a240d97e2e4726605225b/${verb}`)).toEqual({
        resource: 'vendors',
        action: 'edit',
      });
    }
  });

  it('files money under payments even when it hangs off a vendor or customer', () => {
    expect(cell('GET', '/api/admin/businesses/abc/wallet')).toEqual({ resource: 'payments', action: 'view' });
    expect(cell('GET', '/api/admin/businesses/abc/transactions')).toEqual({ resource: 'payments', action: 'view' });
    expect(cell('GET', '/api/admin/customer/abc/transactions')).toEqual({ resource: 'payments', action: 'view' });
    expect(cell('GET', '/api/transactions/vendor')).toEqual({ resource: 'payments', action: 'view' });
  });

  it('maps the console-only user routes to admin management', () => {
    expect(cell('GET', '/api/users/admins')).toEqual({ resource: 'admin-management', action: 'view' });
    expect(cell('POST', '/api/users/admins')).toEqual({ resource: 'admin-management', action: 'create' });
    expect(cell('PUT', '/api/users/roles/abc/permissions')).toEqual({ resource: 'admin-management', action: 'edit' });
    expect(cell('GET', '/api/users/permissions')).toEqual({ resource: 'admin-management', action: 'view' });
  });

  it('reading platform settings is free; changing them is settings.edit', () => {
    expect(cell('GET', '/api/users/platform-settings')).toBeNull();
    expect(cell('PUT', '/api/users/platform-settings')).toEqual({ resource: 'settings', action: 'edit' });
  });

  it('catalogue, orders, support and help content map to their rows', () => {
    expect(cell('GET', '/api/products')).toEqual({ resource: 'products', action: 'view' });
    expect(cell('PATCH', '/api/admin/products/abc/moderate')).toEqual({ resource: 'products', action: 'edit' });
    expect(cell('GET', '/api/taxonomy/tree')).toEqual({ resource: 'products', action: 'view' });
    expect(cell('GET', '/api/admin/vendor/orders')).toEqual({ resource: 'orders', action: 'view' });
    expect(cell('PATCH', '/api/disputes/abc/resolve')).toEqual({ resource: 'orders', action: 'edit' });
    expect(cell('POST', '/api/admin/abc/reply')).toEqual({ resource: 'tickets', action: 'edit' });
    expect(cell('POST', '/api/admin/businesses/abc/escalate')).toEqual({ resource: 'tickets', action: 'create' });
    expect(cell('POST', '/api/help/admin/articles')).toEqual({ resource: 'blogs', action: 'create' });
  });

  it('an unknown /admin route needs dashboard to read and settings to write', () => {
    expect(cell('GET', '/api/admin/some-new-report')).toEqual({ resource: 'dashboard', action: 'view' });
    expect(cell('POST', '/api/admin/some-new-tool')).toEqual({ resource: 'settings', action: 'create' });
  });

  it('has nothing to say about routes outside the console', () => {
    expect(cell('GET', '/api/users/me')).toBeNull();
    expect(cell('GET', '/api/notifications')).toBeNull();
    expect(cell('POST', '/api/auth/change-password')).toBeNull();
    expect(cell('POST', '/api/uploads/outfits')).toBeNull();
  });
});

describe('console-only paths', () => {
  it('keeps customers and vendors out of /admin and the staff user routes', () => {
    expect(isConsoleOnlyPath('/admin/dashboard')).toBe(true);
    expect(isConsoleOnlyPath('/admin')).toBe(true);
    expect(isConsoleOnlyPath('/users/admins/abc')).toBe(true);
    expect(isConsoleOnlyPath('/users/permissions')).toBe(true);
    // Vendors manage their own team roles through these.
    expect(isConsoleOnlyPath('/users/roles')).toBe(false);
    expect(isConsoleOnlyPath('/users/roles/vendor')).toBe(false);
    expect(isConsoleOnlyPath('/administrators')).toBe(false);
  });
});

describe('while a temporary password is in use', () => {
  it('only the password and profile routes are open', () => {
    expect(passwordChangeAllowed('/auth/change-password')).toBe(true);
    expect(passwordChangeAllowed('/auth/refresh')).toBe(true);
    expect(passwordChangeAllowed('/users/me')).toBe(true);
    expect(passwordChangeAllowed('/users/me/access')).toBe(true);
    expect(passwordChangeAllowed('/admin/dashboard')).toBe(false);
    expect(passwordChangeAllowed('/users/me/profile')).toBe(false);
  });
});

describe('permits and the refusal message', () => {
  it('matches on the exact resource.action name', () => {
    expect(permits(['vendors.view', 'orders.edit'], { resource: 'vendors', action: 'view' })).toBe(true);
    expect(permits(['vendors.view'], { resource: 'vendors', action: 'edit' })).toBe(false);
  });

  it('names the role and the thing in plain words', () => {
    expect(deniedMessage('customer_support', { resource: 'vendors', action: 'edit' })).toBe(
      'Your role (customer support) cannot change Vendors.',
    );
    expect(deniedMessage('sales', { resource: 'admin-management', action: 'view' })).toBe(
      'Your role (sales) cannot view Admin Management.',
    );
  });
});
