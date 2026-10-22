import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationCategory,
  NotificationType,
} from './schemas/notification.schema';

export interface CreateNotificationDto {
  recipient: Types.ObjectId | string;
  recipient_business?: Types.ObjectId | string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, any>;
  action_url?: string;
  /**
   * 'customer' for anything sent to a shopper about their shopping. Left out,
   * a notification for a store (recipient_business set) is 'vendor'.
   */
  audience?: NotificationAudience;
}

export type NotificationAudience = 'customer' | 'vendor';

const audienceOf = (data: CreateNotificationDto): NotificationAudience | null =>
  data.audience ?? (data.recipient_business ? 'vendor' : null);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    @InjectModel('User')
    private readonly userModel: Model<any>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Fan one notification out to every platform admin — the admin work-queue
   * events (new dispute, vendor application, product review, new ticket).
   * Fire-and-forget per recipient: one failed insert must not stop the rest.
   */
  async notifyPlatformAdmins(
    data: Omit<CreateNotificationDto, 'recipient'>,
  ): Promise<void> {
    try {
      const admins = await this.userModel
        .find({ type: 'platform' })
        .select('_id')
        .lean();
      await Promise.all(
        admins.map((admin: any) =>
          this.create({ ...data, recipient: admin._id }).catch((err) =>
            this.logger.error(
              `Failed to notify admin ${admin._id} [${data.type}]: ${err?.message}`,
            ),
          ),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to fan out admin notification [${data.type}]: ${(err as any)?.message}`,
      );
    }
  }

  /**
   * Create a single notification for a user
   */
  async create(data: CreateNotificationDto): Promise<NotificationDocument> {
    try {
      const notification = new this.notificationModel({
        recipient: new Types.ObjectId(data.recipient.toString()),
        recipient_business: data.recipient_business
          ? new Types.ObjectId(data.recipient_business.toString())
          : undefined,
        category: data.category,
        type: data.type,
        title: data.title,
        body: data.body,
        metadata: data.metadata || {},
        action_url: data.action_url,
        audience: audienceOf(data),
      });

      const saved = await notification.save();
      this.logger.log(
        `Notification created: [${data.type}] for user ${data.recipient}`,
      );
      // Realtime ping → the gateway pushes it to the recipient's socket room.
      this.eventEmitter.emit('notification.created', saved);
      return saved;
    } catch (error) {
      this.logger.error('Failed to create notification', error);
      throw error;
    }
  }

  /**
   * Create a notification only if the recipient has no UNREAD notification of
   * the same type against the same subject. Prevents spamming e.g. a low-stock
   * alert on every sale while the product stays low, or one bell entry per
   * message in a back-and-forth conversation. Returns null when skipped.
   *
   * `uniqueBy` names the metadata field that identifies the subject. It
   * defaults to product_id, which is what every caller before the order chat
   * used; the chat passes order_id.
   */
  async createUnique(
    data: CreateNotificationDto,
    uniqueBy: string = 'product_id',
  ): Promise<NotificationDocument | null> {
    const subject = data.metadata?.[uniqueBy];
    if (data.recipient && subject) {
      const exists = await this.notificationModel.exists({
        recipient: new Types.ObjectId(data.recipient.toString()),
        type: data.type,
        [`metadata.${uniqueBy}`]: subject,
        is_read: false,
      });
      if (exists) return null;
    }
    return this.create(data);
  }

  /**
   * Create notifications for multiple recipients at once
   */
  async createMany(
    notifications: CreateNotificationDto[],
  ): Promise<NotificationDocument[]> {
    try {
      const docs = notifications.map((data) => ({
        recipient: new Types.ObjectId(data.recipient.toString()),
        recipient_business: data.recipient_business
          ? new Types.ObjectId(data.recipient_business.toString())
          : undefined,
        category: data.category,
        type: data.type,
        title: data.title,
        body: data.body,
        metadata: data.metadata || {},
        action_url: data.action_url,
        audience: audienceOf(data),
      }));

      const saved = await this.notificationModel.insertMany(docs);
      this.logger.log(`Created ${saved.length} notifications in bulk`);
      return saved as NotificationDocument[];
    } catch (error) {
      this.logger.error('Failed to create bulk notifications', error);
      throw error;
    }
  }

  /**
   * Get paginated notifications for a user, optionally filtered by category
   */
  /**
   * The store a vendor is looking at. A person can sit on several stores'
   * teams (and the same account can own one store and be operations at
   * another); the notification list used to be per USER, so a nudge or an
   * order for store A appeared while they were working in store B - it read
   * as the message going to the wrong vendor. User.business is rewritten on
   * every store switch, so it is the active store. Customers have none, and
   * see everything addressed to them.
   */
  /**
   * What one app's inbox shows: the shop asks for 'customer', the vendor app
   * for 'vendor'. Without one, the account's own type decides (older apps).
   *
   * One login can shop and work on a vendor's team, so neither side may leak
   * into the other: the shop shows shopper notifications only; the vendor app
   * shows its open store's notifications and account-level ones, never a
   * shopper's. Notifications from before `audience` existed are read by the
   * old rule (no store → the account's own side).
   */
  private async inboxScope(
    userId: string,
    requested?: string,
  ): Promise<Record<string, any>> {
    try {
      const user: any = await this.userModel
        .findById(userId)
        .select('business type')
        .lean();
      const type = String(user?.type ?? '');
      if (type === 'platform') return {};
      const side: NotificationAudience =
        requested === 'customer' || requested === 'vendor'
          ? requested
          : type === 'vendor'
            ? 'vendor'
            : 'customer';

      if (side === 'customer') {
        return {
          $or: [
            { audience: 'customer' },
            // Older, untagged: a shopper's own notifications carried no store.
            ...(type === 'vendor'
              ? []
              : [{ audience: null, recipient_business: null }]),
          ],
        };
      }

      const bid = user?.business ? new Types.ObjectId(String(user.business)) : null;
      return {
        audience: { $ne: 'customer' },
        // null also matches account-level notifications (team invites,
        // system notices, anything written before stores were recorded).
        ...(bid ? { recipient_business: { $in: [bid, null] } } : {}),
      };
    } catch {
      return {};
    }
  }

  async getForUser(
    userId: string,
    query: { page?: number; limit?: number; category?: string; audience?: string },
  ) {
    const { page = 1, limit = 20, category } = query;
    const skip = (page - 1) * limit;

    const filter: any = {
      recipient: new Types.ObjectId(userId),
      ...(await this.inboxScope(userId, query.audience)),
    };
    if (category && Object.values(NotificationCategory).includes(category as NotificationCategory)) {
      filter.category = category;
    }

    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter),
    ]);

    return {
      data: notifications,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get unread notification count — total + per category
   */
  async getUnreadCount(userId: string, audience?: string) {
    const recipientId = new Types.ObjectId(userId);
    const scope = await this.inboxScope(userId, audience);

    const counts = await this.notificationModel.aggregate([
      { $match: { recipient: recipientId, is_read: false, ...scope } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
        },
      },
    ]);

    const byCategory: Record<string, number> = {};
    let total = 0;

    for (const item of counts) {
      byCategory[item._id] = item.count;
      total += item.count;
    }

    return { total, byCategory };
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.notificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notificationId),
        recipient: new Types.ObjectId(userId),
      },
      { is_read: true },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string, audience?: string) {
    // Only this app's inbox: marking the shop's notifications read must not
    // clear the vendor app's (and the other way round).
    const result = await this.notificationModel.updateMany(
      {
        recipient: new Types.ObjectId(userId),
        is_read: false,
        ...(await this.inboxScope(userId, audience)),
      },
      { is_read: true },
    );

    return { message: `Marked ${result.modifiedCount} notifications as read` };
  }
}
