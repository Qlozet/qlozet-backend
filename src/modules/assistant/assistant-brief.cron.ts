import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AssistantBriefService } from './assistant-brief.service';
import { AnthropicAuthService } from './llm/anthropic-auth.service';

/**
 * Writes the admin morning brief. 07:00 server time daily; disabled with
 * ASSISTANT_DIGEST_ENABLED=false or when no Anthropic auth is configured,
 * like the vendor digest.
 */
@Injectable()
export class AssistantBriefCron {
  private readonly logger = new Logger(AssistantBriefCron.name);

  constructor(
    private readonly briefs: AssistantBriefService,
    private readonly config: ConfigService,
    private readonly auth: AnthropicAuthService,
  ) {}

  private enabled(): boolean {
    if (this.config.get<string>('ASSISTANT_DIGEST_ENABLED') === 'false') return false;
    return this.auth.isConfigured();
  }

  @Cron('0 7 * * *')
  async run() {
    if (!this.enabled()) {
      this.logger.log('[BriefCron] disabled - skipping.');
      return;
    }
    try {
      const brief = await this.briefs.generate();
      this.logger.log(`[BriefCron] ${brief ? 'written' : 'nothing to write'}`);
    } catch (e: any) {
      this.logger.error(`[BriefCron] failed: ${e?.message}`);
    }
  }
}
