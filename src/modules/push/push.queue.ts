import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { Model } from 'mongoose';
import { PushService } from './push.service';

export const PUSH_QUEUE = 'push';

/** Topics the apps subscribe to for announcements (see the push guide). */
export const ANNOUNCEMENT_TOPICS = {
  customers: 'announcements-shop',
  vendors: 'announcements-vendor',
} as const;

/**
 * Turns every saved in-app notification into a push job.
 *
 * Nothing in orders, returns, quotes or chat calls Firebase: they create an
 * in-app notification as they always have, and this listener queues its
 * push. A slow or failing push can never break the action that caused it,
 * and the job id (the notification's id) means a retry never sends twice.
 */
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger(PushDispatcher.name);

  constructor(
    @InjectQueue(PUSH_QUEUE) private readonly queue: Queue,
    private readonly push: PushService,
  ) {}

  @OnEvent('notification.created', { async: true })
  async onNotificationCreated(notification: any) {
    if (!this.push.enabled || !notification?._id) return;
    try {
      await this.queue.add(
        'send',
        { notificationId: String(notification._id) },
        {
          jobId: `push-${String(notification._id)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    } catch (err) {
      this.logger.warn(`Could not queue push for ${notification._id}: ${(err as any)?.message}`);
    }
  }

  /** Announcements go to a topic, not to every token one by one. */
  @OnEvent('broadcast.sent', { async: true })
  async onBroadcastSent(e: { audience: 'customers' | 'vendors'; title: string; body: string; broadcast_id: string }) {
    const topic = ANNOUNCEMENT_TOPICS[e.audience];
    if (!this.push.enabled || !topic) return;
    try {
      await this.push.sendToTopic(topic, {
        title: e.title,
        body: e.body,
        data: { type: 'announcement', category: 'system', broadcast_id: e.broadcast_id, route: '/' },
      });
    } catch (err) {
      this.logger.warn(`Announcement push failed: ${(err as any)?.message}`);
    }
  }
}

@Processor(PUSH_QUEUE)
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger(PushProcessor.name);

  constructor(
    private readonly push: PushService,
    @InjectModel('Notification') private readonly notificationModel: Model<any>,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: string }>) {
    const n = await this.notificationModel.findById(job.data.notificationId).lean();
    if (!n) return { skipped: 'notification gone' };
    // Read on another screen before the push went out: nothing to tell.
    if ((n as any).is_read) return { skipped: 'already read' };
    try {
      return await this.push.sendForNotification(n);
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.errorInfo?.code ?? '';
      // A bad payload won't get better on retry.
      if (code === 'messaging/invalid-argument') {
        this.logger.error(`Push payload refused for ${job.data.notificationId}: ${(err as any)?.message}`);
        return { skipped: 'invalid payload' };
      }
      throw err;
    }
  }
}
