import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class GuardrailsService {
  private openai: OpenAI;
  private readonly logger = new Logger(GuardrailsService.name);

  /**
   * In-memory rate limiter: Map<identifier, timestamp[]>
   * Cleaned up periodically to avoid memory leaks.
   */
  private rateLimitMap = new Map<string, number[]>();
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey: apiKey || 'dummy' });

    // Periodic cleanup of stale rate limit entries
    setInterval(() => this.cleanupRateLimits(), this.CLEANUP_INTERVAL);
  }

  // ─── Input Validation ────────────────────────────────────────────

  validateInput(query: string): { valid: boolean; reason?: string } {
    if (!query || !query.trim()) {
      return { valid: false, reason: 'Query is required' };
    }

    if (query.length > 500) {
      return {
        valid: false,
        reason: 'Query too long (max 500 characters)',
      };
    }

    return { valid: true };
  }

  // ─── Content Moderation (OpenAI Moderation API — free) ───────────

  async moderateContent(
    query: string,
  ): Promise<{ safe: boolean; reason?: string }> {
    try {
      if (this.openai.apiKey === 'dummy') {
        this.logger.warn('Skipping moderation (no API key)');
        return { safe: true };
      }

      const result = await this.openai.moderations.create({ input: query });
      const flagged = result.results[0].flagged;

      if (flagged) {
        const categories = Object.entries(result.results[0].categories)
          .filter(([_, v]) => v)
          .map(([k]) => k);

        this.logger.warn(
          `Content flagged for: ${categories.join(', ')} — query: "${query}"`,
        );

        return {
          safe: false,
          reason: `Your message was flagged for: ${categories.join(', ')}. Please ask a fashion-related question.`,
        };
      }

      return { safe: true };
    } catch (error) {
      // Fail-open: don't block users if moderation API is down
      this.logger.error('Moderation API failed, proceeding anyway', error);
      return { safe: true };
    }
  }

  // ─── Output Sanitization ─────────────────────────────────────────

  sanitizeReply(reply: string): string {
    let clean = reply;

    // Strip any URLs the LLM might have hallucinated
    clean = clean.replace(/https?:\/\/\S+/gi, '');

    // Strip HTML/script tags
    clean = clean.replace(/<[^>]*>/g, '');

    // Strip markdown links but keep the label text
    clean = clean.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

    // Collapse multiple spaces/newlines from removals
    clean = clean.replace(/\s{3,}/g, '  ');

    // Hard truncate if somehow exceeds max length
    if (clean.length > 2000) {
      clean = clean.substring(0, 2000) + '...';
    }

    return clean.trim();
  }

  // ─── Rate Limiting ───────────────────────────────────────────────

  checkRateLimit(
    identifier: string,
    maxRequests: number = 5,
    windowMs: number = 60_000,
  ): void {
    const now = Date.now();
    const timestamps = (this.rateLimitMap.get(identifier) || []).filter(
      (t) => now - t < windowMs,
    );

    if (timestamps.length >= maxRequests) {
      throw new HttpException(
        'Too many requests. Please wait a moment before asking again.',
        429,
      );
    }

    timestamps.push(now);
    this.rateLimitMap.set(identifier, timestamps);
  }

  // ─── Cleanup ─────────────────────────────────────────────────────

  private cleanupRateLimits(): void {
    const now = Date.now();
    const windowMs = 60_000;

    for (const [key, timestamps] of this.rateLimitMap.entries()) {
      const active = timestamps.filter((t) => now - t < windowMs);
      if (active.length === 0) {
        this.rateLimitMap.delete(key);
      } else {
        this.rateLimitMap.set(key, active);
      }
    }
  }
}
