import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { UserType } from '../ums/schemas/user.schema';
import { MailService } from './mail/mail.service';
import {
  Broadcast,
  BroadcastAudience,
  BroadcastDocument,
  BroadcastStatus,
} from './schemas/broadcast.schema';
import {
  Notification,
  NotificationCategory,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

export interface CreateBroadcastInput {
  subject: string;
  body: string;
  audience: BroadcastAudience;
  send_email?: boolean;
  scheduled_at?: string | Date | null;
}

/** Recipients are written in chunks — one insert of 20,000 is a bad idea. */
const INSERT_BATCH = 500;

/** Concurrent emails in flight. Enough to be quick, not enough to be rude. */
const EMAIL_CONCURRENCY = 5;

const AUDIENCE_USER_TYPE: Record<BroadcastAudience, UserType> = {
  [BroadcastAudience.CUSTOMERS]: UserType.CUSTOMER,
  [BroadcastAudience.VENDORS]: UserType.VENDOR,
  [BroadcastAudience.ADMINS]: UserType.PLATFORM,
};

/**
 * Admin announcements to a whole audience.
 *
 * The send runs detached from the request. A broadcast to every customer is
 * thousands of inserts and possibly thousands of emails; holding an HTTP
 * connection open for that would time out and leave the admin with no idea
 * whether it worked. So the record is created first, returned immediately, and
 * the progress counters on it are the status anyone reads afterwards.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<BroadcastDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel('User') private readonly userModel: Model<any>,
    private readonly mailService: MailService,
  ) {}

  async create(input: CreateBroadcastInput, admin: { id: string; name?: string }) {
    const subject = input.subject?.trim();
    const body = input.body?.trim();
    if (!subject) throw new BadRequestException('A subject is required.');
    if (!body) throw new BadRequestException('A message is required.');
    if (!AUDIENCE_USER_TYPE[input.audience]) {
      throw new BadRequestException('Pick who this goes to.');
    }

    // A scheduled time in the past means "now" rather than an error — the
    // alternative is rejecting a send because the admin took a minute to
    // finish writing it.
    let scheduledAt: Date | null = null;
    if (input.scheduled_at) {
      const when = new Date(input.scheduled_at);
      if (Number.isNaN(when.getTime())) {
        throw new BadRequestException('That send time is not a valid date.');
      }
      if (when.getTime() > Date.now()) scheduledAt = when;
    }

    const broadcast = await this.broadcastModel.create({
      subject,
      body,
      audience: input.audience,
      send_email: input.send_email !== false,
      scheduled_at: scheduledAt,
      status: scheduledAt ? BroadcastStatus.SCHEDULED : BroadcastStatus.SENDING,
      created_by: new Types.ObjectId(admin.id),
      created_by_name: admin.name,
    });

    if (!scheduledAt) {
      // Detached on purpose — see the class comment.
      void this.dispatch(String(broadcast._id));
    }

    return {
      message: scheduledAt
        ? 'Announcement scheduled'
        : 'Announcement is being sent',
      data: broadcast,
    };
  }

  async list(page = 1, limit = 20) {
    const skip = (Math.max(page, 1) - 1) * limit;
    const [rows, total] = await Promise.all([
      this.broadcastModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.broadcastModel.countDocuments(),
    ]);
    return {
      message: 'Announcements fetched',
      data: {
        rows,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  /** Only a send that has not started can be called off. */
  async cancel(id: string) {
    const broadcast = await this.broadcastModel.findById(id);
    if (!broadcast) throw new NotFoundException('Announcement not found');
    if (broadcast.status !== BroadcastStatus.SCHEDULED) {
      throw new BadRequestException(
        'Only a scheduled announcement can be cancelled — this one has already started sending.',
      );
    }
    broadcast.status = BroadcastStatus.CANCELLED;
    await broadcast.save();
    return { message: 'Announcement cancelled', data: broadcast };
  }

  /**
   * Fan one broadcast out. Never throws: it records what happened on the
   * broadcast instead, because nobody is waiting on the promise.
   */
  async dispatch(id: string): Promise<void> {
    const broadcast = await this.broadcastModel.findById(id);
    if (!broadcast) return;
    if (
      broadcast.status !== BroadcastStatus.SENDING &&
      broadcast.status !== BroadcastStatus.SCHEDULED
    ) {
      return; // already sent, failed or cancelled
    }

    try {
      broadcast.status = BroadcastStatus.SENDING;
      await broadcast.save();

      const recipients = await this.userModel
        .find({ type: AUDIENCE_USER_TYPE[broadcast.audience] })
        .select('_id email full_name first_name')
        .lean();

      broadcast.recipient_count = recipients.length;
      await broadcast.save();

      await this.createNotifications(broadcast, recipients);

      if (broadcast.send_email) {
        await this.sendEmails(broadcast, recipients);
      }

      broadcast.status = BroadcastStatus.SENT;
      broadcast.sent_at = new Date();
      await broadcast.save();

      this.logger.log(
        `Broadcast ${id} sent to ${recipients.length} ${broadcast.audience}` +
          (broadcast.send_email
            ? ` (${broadcast.emails_sent} emails, ${broadcast.emails_failed} failed)`
            : ' (in-app only)'),
      );
    } catch (err: any) {
      this.logger.error(`Broadcast ${id} failed: ${err?.message}`);
      await this.broadcastModel
        .findByIdAndUpdate(id, {
          status: BroadcastStatus.FAILED,
          error: err?.message?.slice(0, 500) ?? 'Unknown error',
        })
        .catch(() => undefined);
    }
  }

  private async createNotifications(
    broadcast: BroadcastDocument,
    recipients: any[],
  ) {
    // The bell shows text, not markup.
    const plain = broadcast.body
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const body = plain.length > 300 ? `${plain.slice(0, 300).trimEnd()}...` : plain;

    for (let i = 0; i < recipients.length; i += INSERT_BATCH) {
      const chunk = recipients.slice(i, i + INSERT_BATCH);
      await this.notificationModel.insertMany(
        chunk.map((user) => ({
          recipient: user._id,
          category: NotificationCategory.SYSTEM,
          type: NotificationType.ANNOUNCEMENT,
          title: broadcast.subject,
          body,
          metadata: { broadcast_id: String(broadcast._id) },
          action_url: '/',
        })),
        // One malformed row must not lose the whole batch.
        { ordered: false },
      );
    }
  }

  private async sendEmails(broadcast: BroadcastDocument, recipients: any[]) {
    const withEmail = recipients.filter((u) => u?.email);
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < withEmail.length; i += EMAIL_CONCURRENCY) {
      const chunk = withEmail.slice(i, i + EMAIL_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((user) =>
          this.mailService.sendAnnouncementEmail(
            user.email,
            broadcast.subject,
            broadcast.body,
            user.full_name || user.first_name,
          ),
        ),
      );
      for (const ok of results) ok ? sent++ : failed++;

      // Checkpoint as it goes, so a long run shows progress rather than
      // looking stuck until the very end.
      broadcast.emails_sent = sent;
      broadcast.emails_failed = failed;
      await broadcast.save();
    }
  }

  /**
   * Scheduled sends. Every five minutes rather than every minute: nobody
   * schedules an announcement to the minute, and a cheap query run often is
   * still a query run often.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendDueBroadcasts() {
    try {
      const due = await this.broadcastModel
        .find({
          status: BroadcastStatus.SCHEDULED,
          scheduled_at: { $ne: null, $lte: new Date() },
        })
        .select('_id')
        .lean();

      for (const row of due) {
        await this.dispatch(String((row as any)._id));
      }
    } catch (err: any) {
      this.logger.error(`Scheduled broadcast sweep failed: ${err?.message}`);
    }
  }
}
