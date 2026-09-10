import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AssistantDigestService } from './assistant-digest.service';
import { AnthropicAuthService } from './llm/anthropic-auth.service';

/**
 * Fires the weekly per-vendor digest generation. Disabled when
 * ASSISTANT_DIGEST_ENABLED=false or when no Anthropic auth is configured —
 * neither workload identity (Fly) nor ANTHROPIC_API_KEY (local dev).
 */
@Injectable()
export class AssistantDigestCron {
  private readonly logger = new Logger(AssistantDigestCron.name);

  constructor(
    private readonly digestService: AssistantDigestService,
    private readonly config: ConfigService,
    private readonly auth: AnthropicAuthService,
  ) {}

  private enabled(): boolean {
    if (this.config.get<string>('ASSISTANT_DIGEST_ENABLED') === 'false') {
      return false;
    }
    return this.auth.isConfigured();
  }

  // Sunday 00:00 (CronExpression.EVERY_WEEK = '0 0 * * 0') — summarises the
  // last 7 days, i.e. the week that just ended.
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
