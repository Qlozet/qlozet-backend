import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnthropicAuthService } from '../assistant/llm/anthropic-auth.service';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import {
  CatalogueFabric,
  FabricMatch,
  FabricSetMatch,
  matchFabrics,
} from '../products/fabric-match';
import {
  FabricReading,
  fabricReadingRequest,
  parseFabricReading,
} from './fabric-reading';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// On a policy decline, Anthropic re-runs the request on its recommended
// fallback model instead of returning the refusal.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface PhotoFabricMatches {
  fabrics: FabricReading['fabrics'];
  matches: Record<string, FabricMatch[]>;
  sets: FabricSetMatch[];
}

/**
 * Reads the fabrics in a reference photo with Claude and finds the closest
 * fabrics in stock. Best effort: any failure returns null, and the photo
 * analysis carries on without fabric suggestions.
 */
@Injectable()
export class FabricVisionService {
  private readonly logger = new Logger(FabricVisionService.name);

  constructor(
    private readonly auth: AnthropicAuthService,
    private readonly config: ConfigService,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
  ) {}

  private get model(): string {
    return this.config.get<string>('FABRIC_VISION_MODEL') ?? 'claude-opus-5-5';
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
      body: JSON.stringify(withFallback ? { ...body, fallbacks: 'default' } : body),
      signal: AbortSignal.timeout(90_000),
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** The fabrics in the photo, or null. */
  async readFabrics(imageUrl: string): Promise<FabricReading | null> {
    if (!this.auth.isConfigured()) return null;
    const body = fabricReadingRequest(imageUrl, this.model);
    try {
      let { status, json } = await this.post(body, true);
      // An account or model without server-side fallback: ask once without it.
      if (status === 400) ({ status, json } = await this.post(body, false));
      if (status !== 200) {
        this.logger.warn(`Fabric reading failed (${status}): ${json?.error?.message ?? 'no detail'}`);
        return null;
      }
      const reading = parseFabricReading(json);
      if (!reading) this.logger.warn(`Fabric reading unusable (stop_reason=${json?.stop_reason})`);
      return reading;
    } catch (err: any) {
      this.logger.warn(`Fabric reading failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /** Active, in-stock fabric listings in the shape the matcher reads. */
  private async catalogue(): Promise<CatalogueFabric[]> {
    const rows = await this.productModel
      .find({ kind: 'fabric', status: 'active', 'fabric.yard_length': { $gt: 0 } })
      .select('fabric business')
      .populate('business', 'business_name')
      .limit(2000)
      .lean();
    return (rows as any[]).map((p) => {
      const f = p.fabric ?? {};
      return {
        id: String(p._id),
        name: f.name ?? 'Fabric',
        image: f.images?.[0]?.url ?? null,
        vendor_id: p.business?._id ? String(p.business._id) : p.business ? String(p.business) : null,
        vendor_name: p.business?.business_name ?? null,
        price_per_yard: Number(f.price_per_yard) || null,
        colors: Array.isArray(f.colors) ? f.colors : [],
        text: [f.name, f.material, f.pattern, f.product_type, f.description].filter(Boolean).join(' '),
      };
    });
  }

  /** Read the photo and rank the catalogue for each fabric in it. */
  async matchPhoto(imageUrl: string): Promise<PhotoFabricMatches | null> {
    const reading = await this.readFabrics(imageUrl);
    if (!reading?.is_outfit || !reading.fabrics.length) return null;
    const { by_role, sets } = matchFabrics(reading.fabrics, await this.catalogue());
    return { fabrics: reading.fabrics, matches: by_role, sets };
  }
}
