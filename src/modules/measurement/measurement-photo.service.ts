import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicAuthService } from '../assistant/llm/anthropic-auth.service';
import {
  PhotoMedia,
  PhotoReading,
  parsePhotoReading,
  photoReadingRequest,
} from './measurement-photo-reading';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** What the shop may send: photos and PDFs, up to 10 MB. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Reads a measurement-book photo (or PDF) with Claude. The file goes inline
 * in the request and is not stored anywhere.
 */
@Injectable()
export class MeasurementPhotoService {
  private readonly logger = new Logger(MeasurementPhotoService.name);

  constructor(
    private readonly auth: AnthropicAuthService,
    private readonly config: ConfigService,
  ) {}

  private get model(): string {
    return (
      this.config.get<string>('MEASUREMENT_PHOTO_MODEL') ?? 'claude-opus-5-5'
    );
  }

  /** The file as the request needs it, or a 400 the customer can act on. */
  static media(file?: {
    buffer?: Buffer;
    mimetype?: string;
    size?: number;
  }): PhotoMedia {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Add a photo of your measurements.');
    }
    if ((file.size ?? file.buffer.length) > PHOTO_MAX_BYTES) {
      throw new BadRequestException(
        'That file is over 10 MB. Try a smaller photo.',
      );
    }
    const type = String(file.mimetype ?? '').toLowerCase();
    const base64 = file.buffer.toString('base64');
    if (type === 'application/pdf') return { kind: 'pdf', base64 };
    if (IMAGE_TYPES.includes(type))
      return { kind: 'image', mediaType: type, base64 };
    throw new BadRequestException('Use a photo (JPG, PNG or WebP) or a PDF.');
  }

  private async post(body: Record<string, unknown>, withFallback: boolean) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        ...(await this.auth.headers()),
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
        ...(withFallback ? { 'anthropic-beta': FALLBACK_BETA } : {}),
      },
      body: JSON.stringify(
        withFallback ? { ...body, fallbacks: 'default' } : body,
      ),
      signal: AbortSignal.timeout(90_000),
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  async read(file: PhotoMedia): Promise<PhotoReading> {
    if (!this.auth.isConfigured()) {
      throw new ServiceUnavailableException(
        "Reading photos isn't available right now. Type your measurements in instead.",
      );
    }
    const body = photoReadingRequest(file, this.model);
    let reading: PhotoReading | null = null;
    try {
      let { status, json } = await this.post(body, true);
      if (status === 400) ({ status, json } = await this.post(body, false));
      if (status !== 200) {
        this.logger.warn(
          `Measurement photo reading failed (${status}): ${json?.error?.message ?? 'no detail'}`,
        );
      } else {
        reading = parsePhotoReading(json);
        if (!reading) {
          this.logger.warn(
            `Measurement photo reading unusable (stop_reason=${json?.stop_reason})`,
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Measurement photo reading failed: ${err?.message ?? err}`,
      );
    }
    if (!reading) {
      throw new ServiceUnavailableException(
        "We couldn't read that photo just now. Try again, or type your measurements in.",
      );
    }
    return reading;
  }
}
