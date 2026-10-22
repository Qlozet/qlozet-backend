import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';

/**
 * One login can be a shopper and a member of a vendor's team. The shop's
 * inbox must show only shopper notifications, and the vendor app's only the
 * open store's (and account-level) ones.
 */
describe('notification audience', () => {
  const userId = new Types.ObjectId().toHexString();
  const store = new Types.ObjectId();

  const build = (user: Record<string, any>) => {
    const created: any[] = [];
    const filters: any[] = [];
    function Model(this: any, doc: any) {
      Object.assign(this, doc);
      this.save = async () => {
        created.push(doc);
        return this;
      };
    }
    (Model as any).find = (f: any) => {
      filters.push(f);
      return { sort: () => ({ skip: () => ({ limit: () => ({ lean: () => ({ exec: async () => [] }) }) }) }) };
    };
    (Model as any).countDocuments = async () => 0;
    (Model as any).updateMany = async (f: any) => {
      filters.push(f);
      return { modifiedCount: 0 };
    };
    const userModel: any = { findById: () => ({ select: () => ({ lean: async () => user }) }) };
    const service = new NotificationsService(Model as any, userModel, { emit: jest.fn() } as any);
    return { service, created, filters };
  };

  it('tags store notifications vendor and leaves a shopper one as sent', async () => {
    const { service, created } = build({ type: 'vendor', business: store });
    await service.create({ recipient: userId, recipient_business: store, category: 'order' as any, type: 'new_order' as any, title: 't', body: 'b' });
    await service.create({ recipient: userId, audience: 'customer', category: 'order' as any, type: 'order_shipped' as any, title: 't', body: 'b' });
    expect(created.map((d) => d.audience)).toEqual(['vendor', 'customer']);
  });

  it('the shop asks for shopper notifications only, even for a vendor login', async () => {
    const { service, filters } = build({ type: 'vendor', business: store });
    await service.getForUser(userId, { audience: 'customer' });
    expect(filters[0].$or).toEqual([{ audience: 'customer' }]);
    expect(filters[0].recipient_business).toBeUndefined();
  });

  it('the vendor app never shows a shopper notification', async () => {
    const { service, filters } = build({ type: 'vendor', business: store });
    await service.getForUser(userId, { audience: 'vendor' });
    expect(filters[0].audience).toEqual({ $ne: 'customer' });
    expect(filters[0].recipient_business).toEqual({ $in: [store, null] });
  });

  it('keeps older untagged notifications for a plain shopper', async () => {
    const { service, filters } = build({ type: 'customer' });
    await service.getForUser(userId, {});
    expect(filters[0].$or).toContainEqual({ audience: null, recipient_business: null });
  });

  it('marks all read in one app only', async () => {
    const { service, filters } = build({ type: 'vendor', business: store });
    await service.markAllAsRead(userId, 'customer');
    expect(filters[0].$or).toEqual([{ audience: 'customer' }]);
  });
});
