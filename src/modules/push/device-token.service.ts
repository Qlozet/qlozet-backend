import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { DeviceToken, DeviceTokenDocument, PushApp } from './schemas/device-token.schema';
import { RegisterPushTokenDto } from './dto/push-token.dto';

/** FCM treats tokens unseen this long as stale. */
const STALE_AFTER_DAYS = 60;

/** Error codes that mean the token will never work again. */
export const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** "…a1b2c3" — enough to tell tokens apart in a log, never the whole token. */
export const maskToken = (token: string) => `…${token.slice(-6)}`;

@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(
    @InjectModel(DeviceToken.name)
    private readonly model: Model<DeviceTokenDocument>,
  ) {}

  /**
   * Upsert keyed on the token. The same token under another login moves to
   * this one, so whoever used the phone before stops getting pushes on it. A
   * reinstall (same device_id, new token) replaces the old row.
   */
  async register(userId: string, dto: RegisterPushTokenDto) {
    const user = new Types.ObjectId(String(userId));
    if (dto.device_id) {
      await this.model.deleteMany({
        user,
        app: dto.app,
        device_id: dto.device_id,
        token: { $ne: dto.token },
      });
    }
    await this.model.updateOne(
      { token: dto.token },
      {
        $set: {
          user,
          app: dto.app,
          platform: dto.platform,
          device_id: dto.device_id ?? null,
          app_version: dto.app_version ?? null,
          last_seen_at: new Date(),
        },
      },
      { upsert: true },
    );
    return { message: 'Push notifications are on for this device.' };
  }

  /** Logout: only the caller's own token is removed. */
  async unregister(userId: string, token: string) {
    await this.model.deleteOne({ user: new Types.ObjectId(String(userId)), token });
    return { message: 'Push notifications are off for this device.' };
  }

  async tokensFor(userId: string, app: PushApp): Promise<string[]> {
    const rows = await this.model
      .find({ user: new Types.ObjectId(String(userId)), app })
      .select('token')
      .lean();
    return rows.map((r) => r.token);
  }

  /** Drop tokens FCM says will never work again (uninstalled, malformed). */
  async removeDead(tokens: string[]) {
    if (!tokens.length) return;
    await this.model.deleteMany({ token: { $in: tokens } });
    this.logger.log(`Removed ${tokens.length} dead push token(s): ${tokens.map(maskToken).join(', ')}`);
  }

  /** Nightly: tokens not re-registered in 60 days are stale. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneStale() {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const res = await this.model.deleteMany({ last_seen_at: { $lt: cutoff } });
    if (res.deletedCount) this.logger.log(`Pruned ${res.deletedCount} stale push token(s)`);
  }
}
