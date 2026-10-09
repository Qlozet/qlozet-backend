import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

/** Why a vendor is where it is in the list. Shown on the row. */
export interface SuggestionReason {
  code:
    | 'fabric_owner'
    | 'category_match'
    | 'well_rated'
    | 'reliable'
    | 'experienced'
    | 'new_here';
  label: string;
}

export interface SuggestedVendor {
  _id: string;
  business_name: string;
  business_logo_url?: string;
  business_logo_svg_url?: string;
  business_category?: string;
  city?: string;
  state?: string;
  average_rating: number;
  total_ratings: number;
  success_rate?: number;
  total_items_sold?: number;
  accepts_external_fabric?: boolean;
  reasons: SuggestionReason[];
}

/**
 * Weights.
 *
 * Owning the design's fabric outranks everything on purpose: it is the only
 * signal here that changes what the customer pays rather than guessing at
 * quality. Every other tailor's quote has the cross-vendor fabric surcharge
 * added at acceptance, so the fabric's owner is genuinely cheaper for this
 * exact design.
 *
 * `is_featured` is deliberately NOT a weight. It exists on the business
 * record, and if it fed this list then "Recommended" would quietly mean
 * "promoted" — which is the thing that makes a ranking untrustworthy.
 */
const W = {
  FABRIC_OWNER: 100,
  CATEGORY_MATCH: 40,
  RATING: 8, // × average (so a 5.0 is worth 40)
  SUCCESS_RATE: 20, // × rate 0..1
  ITEMS_SOLD: 10, // × a saturating curve, never more than this
} as const;

/** Ratings below this are too thin to rank on. */
const MIN_RATINGS_TO_TRUST = 3;

/** Joined within this window counts as new. */
const NEW_VENDOR_DAYS = 60;

/**
 * Slots held for tailors with no track record.
 *
 * Without this the ranking is a closed loop: a new tailor has no ratings and
 * no sales, so they are never suggested, so they never get a quote request,
 * so they never earn a rating. The marketplace would slowly freeze around
 * whoever arrived first — which is, incidentally, exactly what the unsorted
 * list was already doing.
 */
const NEW_VENDOR_SLOTS = 2;

@Injectable()
export class SuggestedVendorsService {
  private readonly logger = new Logger(SuggestedVendorsService.name);

  constructor(
    @InjectModel('BespokeDesign') private readonly designModel: Model<any>,
    @InjectModel('Business') private readonly businessModel: Model<any>,
    @InjectModel('Product') private readonly productModel: Model<any>,
  ) {}

  /** Rank for a saved design, reading its category and fabric. */
  async forDesign(designId: string, limit = 8) {
    const design = await this.designModel
      .findById(designId)
      .select('category gender fabric')
      .populate('fabric', 'business')
      .lean();
    if (!design) throw new NotFoundException('Design not found');

    return this.rank(
      {
        category: (design as any).category,
        fabricOwnerId: (design as any).fabric?.business
          ? String((design as any).fabric.business)
          : null,
      },
      limit,
    );
  }

  /**
   * Rank for a design that has not been saved yet.
   *
   * The studio only persists a design when quotes are requested, so on a
   * first request there is no id to rank against — and that is the common
   * path. Category and fabric are all the ranking needs, and the studio has
   * both in hand.
   */
  async forCriteria(
    criteria: { category?: string; fabricId?: string },
    limit = 8,
  ) {
    let fabricOwnerId: string | null = null;

    // Only a real product id can own a fabric; the studio's fabric slot can
    // also hold a style-library id, which owns nothing.
    if (criteria.fabricId && /^[0-9a-f]{24}$/i.test(criteria.fabricId)) {
      const fabric: any = await this.productModel
        .findById(criteria.fabricId)
        .select('business')
        .lean();
      if (fabric?.business) fabricOwnerId = String(fabric.business);
    }

    return this.rank({ category: criteria.category, fabricOwnerId }, limit);
  }

  private async rank(
    input: { category?: string; fabricOwnerId: string | null },
    limit: number,
  ) {
    const fabricOwnerId = input.fabricOwnerId;
    const design = { category: input.category };

    // Only tailors who take bespoke work. Offering one who does not spends a
    // slot on someone who will never answer, and the API rejects it anyway.
    const candidates = await this.businessModel
      .find({ accepts_bespoke: { $ne: false } })
      .select(
        'business_name business_logo_url business_logo_svg_url business_category ' +
          'city state success_rate total_items_sold accepts_external_fabric createdAt',
      )
      .lean();

    if (!candidates.length) {
      const empty: SuggestedVendor[] = [];
      return {
        message: 'No tailors available',
        data: { vendors: empty, total: 0, ranked_by: [] as string[] },
      };
    }

    const ratings = await this.ratingsByBusiness(
      candidates.map((c: any) => c._id),
    );

    const designCategory = String((design as any).category ?? '')
      .trim()
      .toLowerCase();
    const newCutoff = Date.now() - NEW_VENDOR_DAYS * 24 * 60 * 60 * 1000;

    const scored = candidates.map((biz: any) => {
      const id = String(biz._id);
      const rating = ratings.get(id) ?? { average: 0, count: 0 };
      const reasons: SuggestionReason[] = [];
      let score = 0;

      if (fabricOwnerId && id === fabricOwnerId) {
        score += W.FABRIC_OWNER;
        reasons.push({
          code: 'fabric_owner',
          label: 'Supplies your fabric — no transfer cost',
        });
      }

      const bizCategory = String(biz.business_category ?? '')
        .trim()
        .toLowerCase();
      if (designCategory && bizCategory && bizCategory.includes(designCategory)) {
        score += W.CATEGORY_MATCH;
        reasons.push({
          code: 'category_match',
          label: `Makes ${(design as any).category}`,
        });
      }

      // A single five-star review is not a track record.
      if (rating.count >= MIN_RATINGS_TO_TRUST) {
        score += W.RATING * rating.average;
        if (rating.average >= 4.5) {
          reasons.push({
            code: 'well_rated',
            label: `${rating.average.toFixed(1)} ★ from ${rating.count} reviews`,
          });
        }
      }

      if (typeof biz.success_rate === 'number' && biz.success_rate > 0) {
        // Stored as either a percentage or a fraction depending on vintage.
        const rate = biz.success_rate > 1 ? biz.success_rate / 100 : biz.success_rate;
        score += W.SUCCESS_RATE * Math.min(rate, 1);
        if (rate >= 0.9) {
          reasons.push({ code: 'reliable', label: 'Completes what they take on' });
        }
      }

      const sold = Number(biz.total_items_sold ?? 0);
      if (sold > 0) {
        // Saturating: the gap between 0 and 20 orders should matter far more
        // than the gap between 200 and 2000, or the biggest shop wins forever.
        score += W.ITEMS_SOLD * (sold / (sold + 20));
        if (sold >= 20) {
          reasons.push({ code: 'experienced', label: `${sold} orders delivered` });
        }
      }

      const isNew =
        new Date(biz.createdAt ?? 0).getTime() > newCutoff &&
        rating.count < MIN_RATINGS_TO_TRUST;

      return {
        vendor: {
          _id: id,
          business_name: biz.business_name,
          business_logo_url: biz.business_logo_url,
          business_logo_svg_url: biz.business_logo_svg_url,
          business_category: biz.business_category,
          city: biz.city,
          state: biz.state,
          average_rating: rating.average,
          total_ratings: rating.count,
          success_rate: biz.success_rate,
          total_items_sold: biz.total_items_sold,
          accepts_external_fabric: biz.accepts_external_fabric,
          reasons,
        } as SuggestedVendor,
        score,
        isNew,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Take the ranked list, then make room for newcomers by swapping in the
    // most recent ones rather than appending — appending to the end of a list
    // that gets truncated is the same as not doing it.
    const top = scored.slice(0, limit);
    const newcomers = scored.filter(
      (row) => row.isNew && !top.includes(row),
    );

    if (newcomers.length && top.length === limit) {
      const keep = Math.max(limit - NEW_VENDOR_SLOTS, 1);
      const promoted = newcomers.slice(0, limit - keep).map((row) => ({
        ...row,
        vendor: {
          ...row.vendor,
          reasons: [
            ...row.vendor.reasons,
            { code: 'new_here' as const, label: 'New to Qlozet' },
          ],
        },
      }));
      top.splice(keep, promoted.length, ...promoted);
    }

    return {
      message: 'Suggested tailors fetched',
      data: {
        vendors: top.map((row) => row.vendor),
        total: scored.length,
        // So the client can say what it is ordering by rather than just
        // asserting "recommended".
        ranked_by: (fabricOwnerId
          ? ['fabric', 'category', 'rating', 'reliability']
          : ['category', 'rating', 'reliability']) as string[],
      },
    };
  }

  /**
   * Average rating and count per business.
   *
   * Vendor ratings are not stored on the business — `cumulative_rating` is
   * projected by the public detail endpoint but does not exist on the schema,
   * so it reads undefined. The real numbers live in the `ratings` array
   * embedded on each product, which is why this unwinds.
   */
  private async ratingsByBusiness(
    businessIds: Types.ObjectId[],
  ): Promise<Map<string, { average: number; count: number }>> {
    const out = new Map<string, { average: number; count: number }>();
    try {
      const rows = await this.productModel.aggregate([
        {
          $match: {
            business: { $in: businessIds },
            'ratings.0': { $exists: true },
          },
        },
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
      // A ranking without ratings is still a ranking. Losing the whole list
      // because the rating roll-up failed would be worse.
      this.logger.warn(`Vendor rating roll-up failed: ${err?.message}`);
    }
    return out;
  }
}
