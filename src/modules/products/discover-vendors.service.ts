import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BusinessStatus } from '../business/schemas/business.schema';
import { ProductStatus } from './enums/product-status.enum';

export interface DiscoverVendorsQuery {
  kind: 'clothing' | 'accessory' | 'fabric';
  /** Separates Custom Made from Ready to Wear. */
  clothingType?: 'customize' | 'non_customize';
  audience?: string;
  limit?: number;
  perVendor?: number;
}

/**
 * Weights for the storefront's category rows.
 *
 * Related in spirit to the bespoke tailor ranking but deliberately separate:
 * that one answers "who should make this garment" and leans on the design,
 * while this answers "whose shop is worth showing" and leans on the
 * catalogue. Sharing one scorer would mean neither could change without
 * disturbing the other.
 *
 * Recency is about the VENDOR being active, not about the product being new.
 * The old home page decided membership by whether a vendor's product happened
 * to be among the 50 newest site-wide, which is a different and much harsher
 * thing: a shop with two hundred good items and no upload this month vanished
 * entirely.
 */
const W = {
  VERIFIED: 25,
  RATING: 8, // × average, so 5.0 is worth 40
  ACTIVE_RECENTLY: 20, // × a decaying curve on days since the last listing
  CATALOGUE: 15, // × a saturating curve on how much they stock
} as const;

const MIN_RATINGS_TO_TRUST = 3;
const RECENCY_HALF_LIFE_DAYS = 45;
const NEW_VENDOR_DAYS = 60;
const NEW_VENDOR_SLOTS = 1;

@Injectable()
export class DiscoverVendorsService {
  private readonly logger = new Logger(DiscoverVendorsService.name);

  constructor(
    @InjectModel('Product') private readonly productModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
  ) {}

  /**
   * Vendors who stock one kind of product, best first, each with a few items
   * to show.
   *
   * One query per row. The home page used to fetch the 50 newest products
   * once and split them four ways, which meant the rows competed for a shared
   * budget: if recent uploads skewed to clothing, Fabric and Accessories
   * starved, and a starved row disappeared from the page entirely — not
   * because there was no stock, but because nobody had uploaded recently.
   */
  async vendorsForKind(query: DiscoverVendorsQuery) {
    const limit = Math.min(Math.max(query.limit ?? 8, 1), 24);
    const perVendor = Math.min(Math.max(query.perVendor ?? 4, 1), 10);

    const match = this.productFilter(query);

    // Group the matching catalogue by vendor, keeping the newest few items of
    // each. Done in one aggregation so a row costs one round trip.
    const grouped = await this.productModel.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$business',
          products: { $push: '$$ROOT' },
          product_count: { $sum: 1 },
          last_listed_at: { $max: '$createdAt' },
        },
      },
      { $project: { products: { $slice: ['$products', perVendor] }, product_count: 1, last_listed_at: 1 } },
    ]);

    if (!grouped.length) {
      return {
        message: 'No vendors in this category',
        data: { vendors: [] as any[], total: 0 },
      };
    }

    const businessIds = grouped.map((g: any) => g._id);

    // Only vendors the platform lists — the same statuses getPublicVendors
    // uses, so a row cannot show a shop the storefront refuses to open.
    const businesses = await this.businessModel
      .find({
        _id: { $in: businessIds },
        status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] },
      })
      .select(
        'business_name business_logo_url business_logo_svg_url cover_image_url ' +
          'theme_color description business_category city state status createdAt',
      )
      .lean();

    const byId = new Map(businesses.map((b: any) => [String(b._id), b]));
    const ratings = await this.ratingsByBusiness(businesses.map((b: any) => b._id));
    const now = Date.now();
    const newCutoff = now - NEW_VENDOR_DAYS * 24 * 60 * 60 * 1000;

    const scored = grouped
      .map((row: any) => {
        const biz = byId.get(String(row._id));
        if (!biz) return null; // not listable

        const id = String(row._id);
        const rating = ratings.get(id) ?? { average: 0, count: 0 };
        let score = 0;

        if (biz.status === BusinessStatus.VERIFIED) score += W.VERIFIED;

        // A single five-star review is not a track record.
        if (rating.count >= MIN_RATINGS_TO_TRUST) score += W.RATING * rating.average;

        // Decays rather than cuts off: a vendor who listed 46 days ago should
        // rank just below one who listed on day 44, not drop off a cliff.
        const daysSince =
          (now - new Date(row.last_listed_at ?? 0).getTime()) / 86_400_000;
        score +=
          W.ACTIVE_RECENTLY * Math.pow(0.5, Math.max(daysSince, 0) / RECENCY_HALF_LIFE_DAYS);

        // Saturating: 2 items to 20 matters far more than 200 to 2000, or the
        // row just lists whoever has the biggest catalogue.
        const count = row.product_count ?? 0;
        score += W.CATALOGUE * (count / (count + 10));

        const isNew =
          new Date(biz.createdAt ?? 0).getTime() > newCutoff &&
          rating.count < MIN_RATINGS_TO_TRUST;

        return {
          vendor: {
            ...biz,
            _id: id,
            average_rating: rating.average,
            total_ratings: rating.count,
            verified: biz.status === BusinessStatus.VERIFIED,
            product_count: count,
            products: row.products ?? [],
          },
          score,
          isNew,
        };
      })
      .filter(Boolean) as { vendor: any; score: number; isNew: boolean }[];

    scored.sort((a, b) => b.score - a.score);

    const top = scored.slice(0, limit);

    // Hold a slot for a newcomer, swapping rather than appending — appending
    // to a list that gets truncated is the same as not doing it. Without this
    // the row is a closed loop: never shown, so never rated, so never shown.
    const newcomers = scored.filter((row) => row.isNew && !top.includes(row));
    if (newcomers.length && top.length === limit && limit > NEW_VENDOR_SLOTS) {
      top.splice(limit - NEW_VENDOR_SLOTS, NEW_VENDOR_SLOTS, ...newcomers.slice(0, NEW_VENDOR_SLOTS));
    }

    return {
      message: 'Vendors fetched',
      data: {
        vendors: top.map((row) => row.vendor),
        total: scored.length,
      },
    };
  }

  /**
   * The same visibility rules the public product list applies. Copied in
   * shape rather than called through findAll because that method paginates a
   * flat list, and this needs to group before it truncates.
   */
  private productFilter(query: DiscoverVendorsQuery): Record<string, any> {
    const filter: Record<string, any> = {
      status: ProductStatus.ACTIVE,
      'moderation.status': { $ne: 'rejected' },
      kind: query.kind,
    };

    if (query.kind === 'clothing' && query.clothingType) {
      filter['clothing.type'] = query.clothingType;
    }

    if (query.audience) {
      // Same bidirectional synonyms the product list uses: male↔men,
      // female↔women, and untagged products match their own kind.
      const synonyms: Record<string, string> = {
        male: 'men',
        female: 'women',
        men: 'male',
        women: 'female',
      };
      const values = [
        query.audience,
        'unisex',
        ...(synonyms[query.audience] ? [synonyms[query.audience]] : []),
      ];
      const audienceMatch = { $in: values };
      filter.$or = [
        { [`${query.kind}.taxonomy.audience`]: audienceMatch },
        { [`${query.kind}.taxonomy.audience`]: { $exists: false } },
      ];
    }

    return filter;
  }

  /**
   * Average rating and count per business.
   *
   * Vendor ratings are not stored on the business — `cumulative_rating` is
   * projected by the public detail endpoint but is not on the schema, so it
   * reads undefined. The real values are in the `ratings` array embedded on
   * each product.
   */
  private async ratingsByBusiness(
    businessIds: Types.ObjectId[],
  ): Promise<Map<string, { average: number; count: number }>> {
    const out = new Map<string, { average: number; count: number }>();
    if (!businessIds.length) return out;
    try {
      const rows = await this.productModel.aggregate([
        { $match: { business: { $in: businessIds }, 'ratings.0': { $exists: true } } },
        { $unwind: '$ratings' },
        {
          $group: {
            _id: '$business',
            average: { $avg: '$ratings.value' },
            count: { $sum: 1 },
          },
        },
      ]);
      for (const row of rows) {
        out.set(String(row._id), {
          average: Math.round((row.average ?? 0) * 10) / 10,
          count: row.count ?? 0,
        });
      }
    } catch (err: any) {
      // A row without ratings is still a row.
      this.logger.warn(`Vendor rating roll-up failed: ${err?.message}`);
    }
    return out;
  }
}
