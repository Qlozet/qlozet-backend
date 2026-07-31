import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AssistantDigestService } from './assistant-digest.service';

/**
 * Fires the weekly per-vendor digest generation. Disabled when
 * ASSISTANT_DIGEST_ENABLED=false or when no ANTHROPIC_API_KEY is set (so the
 * cron is a no-op in environments without the assistant configured).
 */
@Injectable()
export class AssistantDigestCron {
  private readonly logger = new Logger(AssistantDigestCron.name);

  constructor(
    private readonly digestService: AssistantDigestService,
    private readonly config: ConfigService,
  ) {}

  private enabled(): boolean {
    if (this.config.get<string>('ASSISTANT_DIGEST_ENABLED') === 'false') {
      return false;
    }
    return !!this.config.get<string>('ANTHROPIC_API_KEY');
  }

  // Monday 07:00 — start-of-week summary of the week just gone.
  @Cron(CronExpression.EVERY_WEEK)
  async run() {
    if (!this.enabled()) {
      this.logger.log('[DigestCron] disabled — skipping.');
      return;
    }
    this.logger.log('[DigestCron] generating weekly vendor digests…');
    try {
      const res = await this.digestService.generateAll();
      this.logger.log(
        `[DigestCron] done: created=${res.created} skipped=${res.skipped} failed=${res.failed}`,
      );
    } catch (e: any) {
      this.logger.error(`[DigestCron] run failed: ${e?.message}`);
    }
  }
}
