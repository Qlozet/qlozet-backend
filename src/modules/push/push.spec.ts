import { Types } from 'mongoose';
import { PushService, pushData } from './push.service';
import { DeviceTokenService } from './device-token.service';
import { notificationRoute } from './notification-route';
import { PushApp, PushPlatform } from './schemas/device-token.schema';

describe('push notifications', () => {
  const userId = new Types.ObjectId().toHexString();

  describe('routing a push to the right app', () => {
    const build = (opts: { tokens: Record<string, string[]>; userType?: string; responses?: any[] }) => {
      const sends: any[] = [];
      const removed: string[][] = [];
      const app: any = {
        messaging: () => ({
          sendEachForMulticast: jest.fn(async (msg: any) => {
            sends.push(msg);
            return {
              responses: opts.responses ?? msg.tokens.map(() => ({ success: true })),
            };
          }),
        }),
      };
      const tokens: any = {
        tokensFor: jest.fn(async (_u: string, a: string) => opts.tokens[a] ?? []),
        removeDead: jest.fn(async (t: string[]) => removed.push(t)),
      };
      const notifications: any = { getUnreadCount: jest.fn(async () => ({ total: 4 })) };
      const userModel: any = {
        findById: () => ({ select: () => ({ lean: async () => ({ type: opts.userType ?? 'customer' }) }) }),
      };
      const service = new PushService(app, tokens, notifications, userModel);
      return { service, sends, removed, tokens };
    };

    const shipped = {
      _id: new Types.ObjectId(),
      recipient: userId,
      audience: 'customer',
      category: 'shipping',
      type: 'order_shipped',
      title: 'Your order is on its way!',
      body: 'Order #ORD-1 has shipped.',
      metadata: { order_reference: 'ORD-1', order_id: new Types.ObjectId(), refund_amount: 0 },
    };

    it('sends a shopper notification to the shop app only, with a route to open', async () => {
      const { service, sends } = build({ tokens: { shop: ['s1'], vendor: ['v1'] } });
      const out = await service.sendForNotification(shipped);
      expect(out.sent).toBe(1);
      expect(sends[0].tokens).toEqual(['s1']);
      expect(sends[0].data.route).toBe('/profile?tab=orders&order=ORD-1&view=track');
      expect(sends[0].android.notification.channelId).toBe('orders');
      expect(sends[0].apns.payload.aps.badge).toBe(4);
    });

    it('sends a store notification to the vendor app only', async () => {
      const { service, sends } = build({ tokens: { shop: ['s1'], vendor: ['v1'] }, userType: 'customer' });
      await service.sendForNotification({ ...shipped, audience: 'vendor', type: 'new_order', category: 'order', action_url: '/orders' });
      expect(sends[0].tokens).toEqual(['v1']);
      expect(sends[0].data.route).toBe('/orders');
    });

    it('sends nothing to staff, who have no phone app', async () => {
      const { service, sends } = build({ tokens: { shop: ['s1'] }, userType: 'platform' });
      const out = await service.sendForNotification({ ...shipped, audience: null });
      expect(out.skipped).toBeDefined();
      expect(sends).toHaveLength(0);
    });

    it('removes tokens Firebase says are dead, and keeps the rest', async () => {
      const { service, removed } = build({
        tokens: { shop: ['dead', 'ok', 'flaky'] },
        responses: [
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: true },
          { success: false, error: { code: 'messaging/internal-error' } },
        ],
      });
      const out = await service.sendForNotification(shipped);
      expect(out).toMatchObject({ sent: 1, failed: 2, removed: 1 });
      expect(removed).toEqual([['dead']]);
    });

    it('does nothing when Firebase is not configured', async () => {
      const service = new PushService(null, {} as any, {} as any, {} as any);
      expect(service.enabled).toBe(false);
      await expect(service.sendForNotification(shipped)).resolves.toMatchObject({ skipped: 'firebase not configured' });
    });
  });

  it('puts only strings in the data payload', () => {
    const data = pushData(
      { _id: 'n1', type: 'order_confirmed', category: 'order', audience: 'customer', metadata: { order_id: new Types.ObjectId(), refund_amount: 5000, nested: { a: 1 }, none: null } },
      '/x',
    );
    expect(Object.values(data).every((v) => typeof v === 'string')).toBe(true);
    expect(data.refund_amount).toBe('5000');
    expect(data.nested).toBeUndefined();
  });

  it('routes like the shop does', () => {
    expect(notificationRoute({ type: 'new_message', category: 'bespoke', audience: 'customer', metadata: { order_reference: 'ORD-2' } })).toBe('/profile?tab=orders&order=ORD-2&view=chat');
    expect(notificationRoute({ type: 'bespoke_quote_received', audience: 'customer', metadata: { design_id: 'd1' } })).toBe('/bespoke?quotes=d1');
    expect(notificationRoute({ type: 'ticket_reply', audience: 'customer', metadata: { ticket_id: 't1' } })).toBe('/help/tickets?ticket=t1');
    expect(notificationRoute({ type: 'order_delivered', category: 'shipping', audience: 'customer', metadata: { order_reference: 'ORD-1' } })).toBe('/profile?tab=orders&order=ORD-1');
  });

  describe('device tokens', () => {
    const makeModel = () => {
      const calls: any[] = [];
      const model: any = {
        deleteMany: jest.fn(async (q: any) => {
          calls.push(['deleteMany', q]);
          return { deletedCount: 0 };
        }),
        updateOne: jest.fn(async (q: any, u: any, o: any) => calls.push(['updateOne', q, u, o])),
        deleteOne: jest.fn(async (q: any) => calls.push(['deleteOne', q])),
      };
      return { model, calls };
    };

    it('upserts on the token, so another login on the phone takes it over', async () => {
      const { model, calls } = makeModel();
      const svc = new DeviceTokenService(model);
      await svc.register(userId, { token: 'tok', app: PushApp.SHOP, platform: PushPlatform.IOS });
      const [, q, u, o] = calls.find((c) => c[0] === 'updateOne');
      expect(q).toEqual({ token: 'tok' });
      expect(String(u.$set.user)).toBe(userId);
      expect(o).toEqual({ upsert: true });
    });

    it('replaces the old token after a reinstall on the same device', async () => {
      const { model, calls } = makeModel();
      const svc = new DeviceTokenService(model);
      await svc.register(userId, { token: 'new', app: PushApp.VENDOR, platform: PushPlatform.ANDROID, device_id: 'dev-1' });
      const del = calls.find((c) => c[0] === 'deleteMany');
      expect(del[1]).toMatchObject({ app: 'vendor', device_id: 'dev-1', token: { $ne: 'new' } });
    });

    it('only removes the caller’s own token on logout', async () => {
      const { model, calls } = makeModel();
      const svc = new DeviceTokenService(model);
      await svc.unregister(userId, 'tok');
      expect(String(calls[0][1].user)).toBe(userId);
      expect(calls[0][1].token).toBe('tok');
    });
  });
});

describe('push preferences', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pushAllowed, preferencesView, switchFor } = require('./push-preferences');

  it('never lets orders, money or account notices be switched off', () => {
    const prefs = { customer: { orders: false, payments: false, announcements: false } };
    expect(pushAllowed(prefs, 'customer', { type: 'order_shipped', category: 'shipping' })).toBe(true);
    expect(pushAllowed(prefs, 'customer', { type: 'order_cancelled', category: 'payment' })).toBe(true);
    expect(pushAllowed(prefs, 'customer', { type: 'announcement', category: 'system' })).toBe(false);
  });

  it('keeps each app’s switches apart', () => {
    const prefs = { vendor: { messages: false } };
    expect(pushAllowed(prefs, 'vendor', { type: 'new_message', category: 'bespoke' })).toBe(false);
    expect(pushAllowed(prefs, 'customer', { type: 'new_message', category: 'bespoke' })).toBe(true);
  });

  it('treats a tailor’s measurement question as an order notice', () => {
    expect(switchFor({ type: 'measurement_question', category: 'order' })).toBe('orders');
  });

  it('shows locked switches as on', () => {
    const view = preferencesView({ customer: { orders: false, product: false } }, 'customer');
    expect(view.find((s: any) => s.key === 'orders')).toMatchObject({ locked: true, enabled: true });
    expect(view.find((s: any) => s.key === 'product')).toMatchObject({ locked: false, enabled: false });
  });
});
