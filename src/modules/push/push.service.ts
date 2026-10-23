import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type * as admin from 'firebase-admin';
import { FIREBASE_APP } from './firebase.provider';
import { DEAD_TOKEN_CODES, DeviceTokenService } from './device-token.service';
import { PushApp } from './schemas/device-token.schema';
import { notificationRoute } from './notification-route';
import { NotificationsService } from '../notifications/notifications.service';

/** FCM's multicast limit per call. */
const MULTICAST_LIMIT = 500;

/**
 * Android notification channels the apps create (Android 8+ drops a push
 * whose channel doesn't exist). Agreed with the mobile team; see the push
 * handoff guide.
 */
export const PUSH_CHANNELS = {
  orders: 'orders', // order, shipping, payment
  bespoke: 'bespoke', // quotes, tailor messages, measurement questions
  updates: 'updates', // product alerts, team, system, announcements
} as const;

const channelFor = (category?: string, type?: string): string => {
  if (type === 'new_message' || type === 'measurement_question' || category === 'bespoke') return PUSH_CHANNELS.bespoke;
  if (category === 'order' || category === 'shipping' || category === 'payment') return PUSH_CHANNELS.orders;
  return PUSH_CHANNELS.updates;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The push payload's data: strings only (FCM refuses anything else). */
export function pushData(n: any, route: string | null): Record<string, string> {
  const data: Record<string, string> = {
    notificationId: String(n._id),
    type: String(n.type ?? ''),
    category: String(n.category ?? ''),
    audience: String(n.audience ?? ''),
  };
  if (route) data.route = route;
  for (const [k, v] of Object.entries(n.metadata ?? {})) {
    if (v === null || v === undefined || k in data) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      data[k] = String(v);
    } else if (typeof v === 'object' && typeof (v as any).toHexString === 'function') {
      data[k] = (v as any).toHexString();
    }
  }
  return data;
}

export interface PushOutcome {
  sent: number;
  failed: number;
  removed: number;
  skipped?: string;
}

/**
 * Sends a stored notification to the right app on the recipient's phones.
 *
 * Every in-app notification is saved first (the inbox is the record) and
 * then pushed; a push that never arrives loses nothing. The app is chosen by
 * the notification's audience, so a login that shops and works for a vendor
 * gets shopper pushes in the shop app and store pushes in the vendor app.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(FIREBASE_APP) private readonly app: admin.app.App | null,
    private readonly tokens: DeviceTokenService,
    private readonly notifications: NotificationsService,
    @InjectModel('User') private readonly userModel: Model<any>,
  ) {}

  get enabled() {
    return Boolean(this.app);
  }

  /** Which app a notification is for; null = no phone app (staff). */
  async appFor(n: { recipient: unknown; audience?: string | null }): Promise<PushApp | null> {
    if (n.audience === 'customer') return PushApp.SHOP;
    if (n.audience === 'vendor') return PushApp.VENDOR;
    const user = await this.userModel.findById(n.recipient).select('type').lean();
    const type = (user as any)?.type;
    if (type === 'customer') return PushApp.SHOP;
    if (type === 'vendor') return PushApp.VENDOR;
    return null;
  }

  async sendForNotification(n: any): Promise<PushOutcome> {
    if (!this.app) return { sent: 0, failed: 0, removed: 0, skipped: 'firebase not configured' };
    const app = await this.appFor(n);
    if (!app) return { sent: 0, failed: 0, removed: 0, skipped: 'no app for this recipient' };
    const userId = String(n.recipient);
    const tokens = await this.tokens.tokensFor(userId, app);
    if (!tokens.length) return { sent: 0, failed: 0, removed: 0, skipped: 'no devices' };

    const audience = app === PushApp.SHOP ? 'customer' : 'vendor';
    const badge = await this.notifications
      .getUnreadCount(userId, audience)
      .then((c) => c.total)
      .catch(() => undefined);

    const outcome = await this.sendToTokens(tokens, {
      title: clip(String(n.title ?? 'Qlozet'), 50),
      body: clip(String(n.body ?? ''), 150),
      data: pushData(n, notificationRoute(n)),
      channel: channelFor(n.category, n.type),
      badge,
    });
    this.logger.log(
      `Push ${n.type} to user ${userId} (${app}): ${outcome.sent} sent, ${outcome.failed} failed, ${outcome.removed} removed`,
    );
    return outcome;
  }

  async sendToTokens(
    tokens: string[],
    msg: { title: string; body: string; data: Record<string, string>; channel: string; badge?: number },
  ): Promise<PushOutcome> {
    if (!this.app) return { sent: 0, failed: 0, removed: 0, skipped: 'firebase not configured' };
    let sent = 0;
    let failed = 0;
    const dead: string[] = [];
    for (let i = 0; i < tokens.length; i += MULTICAST_LIMIT) {
      const chunk = tokens.slice(i, i + MULTICAST_LIMIT);
      const res = await this.app.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title: msg.title, body: msg.body },
        data: msg.data,
        android: {
          priority: 'high',
          notification: { channelId: msg.channel, sound: 'default' },
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { sound: 'default', ...(msg.badge !== undefined ? { badge: msg.badge } : {}) } },
        },
      });
      res.responses.forEach((r, idx) => {
        if (r.success) {
          sent += 1;
          return;
        }
        failed += 1;
        const code = r.error?.code ?? '';
        if (DEAD_TOKEN_CODES.has(code)) dead.push(chunk[idx]);
        else this.logger.warn(`Push failed (${code || 'unknown'}): ${r.error?.message ?? ''}`);
      });
    }
    await this.tokens.removeDead(dead);
    return { sent, failed, removed: dead.length };
  }

  /** Announcements: one send to everyone on an app who subscribed to the topic. */
  async sendToTopic(topic: string, msg: { title: string; body: string; data: Record<string, string> }) {
    if (!this.app) return;
    await this.app.messaging().send({
      topic,
      notification: { title: clip(msg.title, 50), body: clip(msg.body, 150) },
      data: msg.data,
      android: { priority: 'high', notification: { channelId: PUSH_CHANNELS.updates, sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  }
}
