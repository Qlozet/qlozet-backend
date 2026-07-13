import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

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
      });

      const saved = await notification.save();
      this.logger.log(
        `Notification created: [${data.type}] for user ${data.recipient}`,
      );
      return saved;
    } catch (error) {
      this.logger.error('Failed to create notification', error);
      throw error;
    }
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
  async getForUser(
    userId: string,
    query: { page?: number; limit?: number; category?: string },
  ) {
    const { page = 1, limit = 20, category } = query;
    const skip = (page - 1) * limit;

    const filter: any = { recipient: new Types.ObjectId(userId) };
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
  async getUnreadCount(userId: string) {
    const recipientId = new Types.ObjectId(userId);

    const counts = await this.notificationModel.aggregate([
      { $match: { recipient: recipientId, is_read: false } },
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
  async markAllAsRead(userId: string) {
    const result = await this.notificationModel.updateMany(
      { recipient: new Types.ObjectId(userId), is_read: false },
      { is_read: true },
    );

    return { message: `Marked ${result.modifiedCount} notifications as read` };
  }
}
