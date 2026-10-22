import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationSchema } from './schemas/notification.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * A vendor's notification list is scoped to the store they have open. One
 * account can own store A and work at store B; per-user listing showed a
 * nudge sent to store B while the person was looking at store A, which read
 * as "the nudge went to a different vendor". Customers (no store) and
 * store-less notifications are unaffected.
 */
describe('NotificationsService - active-store scoping', () => {
  const mongo = new MemoryMongo();
  let notificationModel: any;
  let service: any;
  let userDoc: any;

  const person = new Types.ObjectId();
  const storeA = new Types.ObjectId();
  const storeB = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    notificationModel = mongo.model('Notification', NotificationSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await notificationModel.deleteMany({});
    userDoc = { _id: person, type: 'vendor', business: storeA };
    service = Object.create(NotificationsService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      notificationModel,
      userModel: {
        findById: () => ({ select: () => ({ lean: async () => userDoc }) }),
      },
    });
    await notificationModel.create([
      { recipient: person, recipient_business: storeA, category: 'order', type: 'new_order', title: 'A order', body: 'x' },
      { recipient: person, recipient_business: storeB, category: 'product', type: 'announcement', title: 'B nudge', body: 'x' },
      { recipient: person, category: 'team', type: 'team_member_joined', title: 'account-level', body: 'x' },
      { recipient: new Types.ObjectId(), recipient_business: storeA, category: 'order', type: 'new_order', title: 'someone else', body: 'x' },
    ]);
  });

  it('lists only the active store plus account-level notices', async () => {
    const result = await service.getForUser(person.toString(), {});
    const titles = result.data.map((n: any) => n.title).sort();
    expect(titles).toEqual(['A order', 'account-level']);
    expect(result.total).toBe(2);
  });

  it('switching stores switches the list', async () => {
    userDoc = { ...userDoc, business: storeB };
    const result = await service.getForUser(person.toString(), {});
    expect(result.data.map((n: any) => n.title).sort()).toEqual(['B nudge', 'account-level']);
  });

  it('counts unread for the active store only', async () => {
    const counts = await service.getUnreadCount(person.toString());
    expect(counts.total).toBe(2);
    expect(counts.byCategory).toEqual({ order: 1, team: 1 });
  });

  it('a customer (no store) sees their own notifications, never a store’s', async () => {
    // Store notifications belong in the vendor app; the shop shows the
    // shopper's own (see notification-audience.spec).
    userDoc = { _id: person, type: 'customer' };
    const result = await service.getForUser(person.toString(), {});
    expect(result.data.map((n: any) => n.title)).toEqual(['account-level']);
  });

  it('a failed user lookup falls back to the unscoped list rather than hiding everything', async () => {
    service.userModel = { findById: () => { throw new Error('db down'); } };
    const result = await service.getForUser(person.toString(), {});
    expect(result.total).toBe(3);
  });
});
