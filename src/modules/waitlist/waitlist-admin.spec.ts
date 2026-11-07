import { signedUpKey, waitlistCsv, waitlistFilter, waitlistPaging } from './waitlist-admin';
import { BOT_FILTER } from './waitlist-bot';
import { normalisePath, resolveConsoleCell } from '../../common/access/console-access';

describe('the admin waitlist', () => {
  it('filters by type and searches name, email or business, treating the text literally', () => {
    const parts = (q: object) => (waitlistFilter(q) as any).$and as Record<string, any>[];
    expect(parts({ type: 'vendor' })).toContainEqual({ type: 'vendor' });
    expect(parts({ type: 'everyone' })).toHaveLength(1);
    const or = parts({ search: ' ada (lagos) ' })[1].$or;
    const rx: RegExp = or[0].fullName;
    expect(rx.test('Ada (Lagos) Okafor')).toBe(true);
    expect(rx.test('ada lagos')).toBe(false);
    expect(or.map((c: object) => Object.keys(c)[0])).toEqual(['fullName', 'email', 'businessName']);
  });

  it('hides likely bots unless asked for them', () => {
    expect((waitlistFilter({}) as any).$and[0]).toEqual({ $nor: BOT_FILTER.$or });
    expect((waitlistFilter({ show: 'bots' }) as any).$and[0]).toBe(BOT_FILTER);
  });

  it('is a customers delete to clear the bots', () => {
    expect(resolveConsoleCell('DELETE', normalisePath('/api/admin/waitlist/bots'))).toEqual({ resource: 'customers', action: 'delete' });
  });

  it('pages within limits', () => {
    expect(waitlistPaging({})).toEqual({ page: 1, size: 25, skip: 0 });
    expect(waitlistPaging({ page: 3, size: 500 })).toEqual({ page: 3, size: 100, skip: 200 });
  });

  it('matches a signed-up account by email and the same account type', () => {
    expect(signedUpKey(' Ada@Mail.com ', 'customer')).toBe('ada@mail.com|customer');
    expect(signedUpKey('ada@mail.com', 'vendor')).not.toBe(signedUpKey('ada@mail.com', 'customer'));
  });

  it('exports a CSV that Excel opens safely', () => {
    const csv = waitlistCsv([
      { type: 'vendor', fullName: '=HYPERLINK("x")', email: 'a@b.ng', businessName: 'Adire, Ltd', createdAt: '2026-11-01T10:00:00Z', signed_up: true },
    ]);
    expect(csv.startsWith('﻿Type,Name,Email')).toBe(true);
    const row = csv.split('\r\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"Adire, Ltd"');
    expect(row.endsWith('2026-11-01,yes')).toBe(true);
  });

  it('is a customers page in the console permission grid', () => {
    expect(resolveConsoleCell('GET', normalisePath('/api/admin/waitlist?type=vendor'))).toEqual({ resource: 'customers', action: 'view' });
    expect(resolveConsoleCell('GET', normalisePath('/api/admin/waitlist/export'))).toEqual({ resource: 'customers', action: 'view' });
  });
});
