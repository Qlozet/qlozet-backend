import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../../products/schemas/product.schema';
import { Business } from '../../business/schemas/business.schema';
import { User } from '../../ums/schemas/user.schema';
import {
  PlatformStyle,
  PlatformStyleDocument,
} from '../../style-library/schemas/platform-style.schema';
import {
  CatalogItem,
  CatalogItemDocument,
} from '../catalog/schemas/catalog-item.schema';
import { customerVisibleProductFilter } from '../../products/customer-visibility';
import { EventsService } from '../events/events.service';
import { EventType } from '../events/enums/event-type.enum';
import { UserEmbeddingsService } from '../user-embeddings/user-embeddings.service';
import {
  Candidate,
  LOOK_RULES,
  LOOK_STYLE_CATEGORIES,
  Look,
  MIN_PRODUCT_LOOKS,
  OnboardingGender,
  audienceRegex,
  centroid,
  cosine,
  pickVaried,
  shuffle,
  styleWords,
} from './onboarding-picks';

/** How many live listings to draw from each time (sampled, so the grid varies). */
const POOL_SIZE = 240;
/** A designer needs at least this many live listings to be suggested. */
const MIN_DESIGNER_LISTINGS = 3;
const MAX_PICKS = 40;

interface PoolProduct {
  _id: Types.ObjectId;
  name: string;
  business: any;
  clothing?: { name?: string; images?: { url?: string }[]; taxonomy?: any };
}

/**
 * The "pick looks you love" and "follow designers" steps at sign-up (and
 * "Update my style" later). Real listings come first; the platform style
 * library fills in when there are too few. What is picked feeds the
 * recommendations: each product as a liked item, each style as style words.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Business.name) private businessModel: Model<Business>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PlatformStyle.name)
    private styleModel: Model<PlatformStyleDocument>,
    @InjectModel(CatalogItem.name)
    private catalogModel: Model<CatalogItemDocument>,
    private eventsService: EventsService,
    private userEmbeddingsService: UserEmbeddingsService,
  ) {}

  // ── Looks ────────────────────────────────────────────────────────────────

  async getLooks(gender: OnboardingGender, limit = LOOK_RULES.limit, q?: string) {
    const search = searchRegex(q);
    const rules = { ...LOOK_RULES, limit: clamp(limit, 6, 30) };
    const pool = await this.productPool(gender, search);
    const products = pickVaried(shuffle(pool), rules);

    let looks = products;
    // A search always offers matching platform styles too.
    if (search || products.length < MIN_PRODUCT_LOOKS) {
      const styles = await this.styleCandidates(gender, search);
      looks = [...products, ...pickVaried(styles, { ...rules, limit: rules.limit - products.length })];
    }

    const hasProducts = products.length > 0;
    const hasStyles = looks.length > products.length;
    return {
      source: hasProducts && hasStyles ? 'mixed' : hasProducts ? 'products' : hasStyles ? 'styles' : 'none',
      min_picks: 3,
      looks: looks.map((c) => c.look),
    };
  }

  /** "More like this" after a look is tapped: similar but not copies. */
  async getSimilar(opts: {
    kind: 'product' | 'style';
    id: string;
    gender: OnboardingGender;
    exclude: string[];
    limit?: number;
  }) {
    const limit = clamp(opts.limit ?? 3, 1, 6);
    const exclude = new Set([...opts.exclude, opts.id]);

    if (opts.kind === 'style') {
      return { looks: await this.similarStyles(opts.id, opts.gender, exclude, limit) };
    }

    if (!Types.ObjectId.isValid(opts.id)) throw new BadRequestException('Invalid look');
    const pool = await this.productPool(opts.gender);
    const [target] = await this.withVectors(
      await this.visibleProducts([opts.id]).then((p) => p.map((x) => this.toCandidate(x))),
    );
    if (!target) return { looks: [] };

    const others = pool.filter((c) => !exclude.has(c.look.id));
    const ranked = target.vector?.length
      ? others
          .map((c) => ({ c, score: cosine(target.vector, c.vector) + sameCategoryBonus(target, c) }))
          .sort((a, b) => b.score - a.score)
          .map((x) => x.c)
      : // No embedding yet: same category first, otherwise any order.
        [...others.filter((c) => sameCategoryBonus(target, c) > 0), ...shuffle(others)];

    const already = opts.exclude.length
      ? await this.withVectors(
          await this.visibleProducts(opts.exclude.filter((id) => Types.ObjectId.isValid(id))).then((p) =>
            p.map((x) => this.toCandidate(x)),
          ),
        )
      : [];
    const looks = pickVaried(ranked, { ...LOOK_RULES, limit, perCategory: limit }, [target, ...already]);
    return { looks: looks.map((c) => c.look) };
  }

  // ── Designers ────────────────────────────────────────────────────────────

  async getDesigners(userId: string, gender: OnboardingGender, picked: string[], limit = 12, q?: string) {
    limit = clamp(limit, 3, 24);
    const search = searchRegex(q);
    const audience = audienceRegex(gender);

    // Approved stores and how many live listings for this shopper each has.
    const approved = await this.approvedBusinessIds();
    const counts: { _id: any; n: number }[] = await this.productModel.aggregate([
      {
        $match: {
          ...customerVisibleProductFilter(),
          deleted_at: null,
          business: { $in: approved },
          $or: [
            { kind: 'clothing', 'clothing.taxonomy.audience': audience },
            { kind: { $in: ['fabric', 'accessory'] } },
          ],
        },
      },
      { $group: { _id: '$business', n: { $sum: 1 } } },
    ]);
    let eligible = counts.filter((c) => c.n >= MIN_DESIGNER_LISTINGS);
    if (!eligible.length) eligible = counts; // early days: any live store
    if (!eligible.length) return { designers: [] };
    const countBy = new Map(eligible.map((c) => [String(c._id), c.n]));

    // Rank: stores behind the picked looks, then stores whose work is closest
    // in style to the picks, then by followers.
    const pickedProducts = await this.visibleProducts(picked.filter((id) => Types.ObjectId.isValid(id)));
    const pickedBy = new Map<string, number>();
    for (const p of pickedProducts) {
      const b = String(p.business?._id ?? p.business);
      pickedBy.set(b, (pickedBy.get(b) ?? 0) + 1);
    }
    const pickedCandidates = await this.withVectors(pickedProducts.map((p) => this.toCandidate(p)));
    const taste = centroid(pickedCandidates.map((c) => c.vector));

    const pool = await this.productPool(gender);
    const bestMatch = new Map<string, number>();
    const covers = new Map<string, string[]>();
    for (const c of pool) {
      const b = c.vendorKey!;
      if (!countBy.has(b)) continue;
      const score = taste ? cosine(taste, c.vector) : 0;
      bestMatch.set(b, Math.max(bestMatch.get(b) ?? -1, score));
      const list = covers.get(b) ?? [];
      if (list.length < 3) list.push(c.look.image);
      covers.set(b, list);
    }

    const businesses: any[] = await this.businessModel
      .find({
        _id: { $in: eligible.map((c) => c._id) },
        ...(search ? { business_name: search } : {}),
      })
      .select('business_name business_logo_url followers')
      .lean();

    const ranked = businesses
      .map((b) => {
        const id = String(b._id);
        const followers: any[] = b.followers ?? [];
        return {
          id,
          business_name: b.business_name,
          business_logo_url: b.business_logo_url ?? null,
          cover_images: covers.get(id) ?? [],
          listings: countBy.get(id) ?? 0,
          followers_count: followers.length,
          following: followers.some((f) => String(f) === String(userId)),
          score:
            (pickedBy.get(id) ?? 0) * 10 +
            (bestMatch.get(id) ?? 0) * 3 +
            Math.log10(1 + followers.length) * 0.5 +
            Math.random() * 0.05,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...rest }) => rest);

    return { designers: ranked };
  }

  // ── Saving picks ─────────────────────────────────────────────────────────

  async savePicks(userId: string, productIds: string[], styleIds: string[]) {
    const pids = unique(productIds).filter((id) => Types.ObjectId.isValid(id)).slice(0, MAX_PICKS);
    const sids = unique(styleIds).filter((id) => Types.ObjectId.isValid(id)).slice(0, MAX_PICKS);

    const [products, styles] = await Promise.all([
      this.visibleProducts(pids),
      sids.length
        ? this.styleModel
            .find({ _id: { $in: sids }, business: null, is_active: true })
            .select('name attributes')
            .lean()
        : Promise.resolve([] as any[]),
    ]);

    const words = styleWords(
      products.map((p) => ({
        categories: p.clothing?.taxonomy?.categories,
        productType: p.clothing?.taxonomy?.product_type,
      })),
      styles.map((s: any) => ({ name: s.name, attributes: s.attributes })),
    );

    // Each product picked counts like a strong like for the home feed.
    await Promise.all(
      products.map((p) =>
        this.eventsService
          .logEvent({
            userId: String(userId),
            eventType: EventType.PREFERRED_AESTHETIC,
            properties: { itemId: String(p._id), source: 'onboarding' },
          })
          .catch((e) => this.logger.warn(`Onboarding pick event failed: ${e.message}`)),
      ),
    );

    await this.userModel.updateOne(
      { _id: new Types.ObjectId(String(userId)) },
      { $set: { aesthetic_preferences: words } },
    );
    await this.userEmbeddingsService.invalidateCache(String(userId));

    return {
      saved_products: products.length,
      saved_styles: styles.length,
      aesthetic_preferences: words,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async approvedBusinessIds(): Promise<any[]> {
    const ids: any[] = await this.businessModel.distinct('_id', {
      status: { $in: ['approved', 'verified'] },
      is_active: { $ne: false },
    });
    // Some older references were saved as strings; match either form.
    return [...ids, ...ids.map((id) => String(id))];
  }

  /** A random sample of live clothing for this shopper, with style vectors. */
  private async productPool(gender: OnboardingGender, search?: RegExp | null): Promise<Candidate[]> {
    const approved = await this.approvedBusinessIds();
    const docs: PoolProduct[] = await this.productModel.aggregate([
      {
        $match: {
          ...customerVisibleProductFilter(),
          deleted_at: null,
          kind: 'clothing',
          business: { $in: approved },
          'clothing.taxonomy.audience': audienceRegex(gender),
          'clothing.images.0.url': { $exists: true, $nin: [null, ''] },
          ...(search
            ? {
                $or: [
                  { name: search },
                  { 'clothing.taxonomy.categories': search },
                  { 'clothing.taxonomy.product_type': search },
                ],
              }
            : {}),
        },
      },
      { $sample: { size: POOL_SIZE } },
      {
        $project: {
          name: 1,
          business: 1,
          clothing: {
            name: '$clothing.name',
            images: { $slice: ['$clothing.images', 1] },
            taxonomy: '$clothing.taxonomy',
          },
        },
      },
    ]);
    await this.attachVendorNames(docs);
    return this.withVectors(docs.map((d) => this.toCandidate(d)));
  }

  /** Customer-visible clothing by id, from approved stores, in the order given. */
  private async visibleProducts(ids: string[]): Promise<PoolProduct[]> {
    if (!ids.length) return [];
    const approved = await this.approvedBusinessIds();
    const docs = (await this.productModel
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        ...customerVisibleProductFilter(),
        deleted_at: null,
        kind: 'clothing',
        business: { $in: approved },
      })
      .select('name business clothing.name clothing.images clothing.taxonomy')
      .lean()) as unknown as PoolProduct[];
    await this.attachVendorNames(docs);
    const order = new Map(ids.map((id, i) => [id, i]));
    return docs.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  }

  private async attachVendorNames(docs: PoolProduct[]): Promise<void> {
    const ids = unique(docs.map((d) => String(d.business?._id ?? d.business)));
    if (!ids.length) return;
    const names: any[] = await this.businessModel
      .find({ _id: { $in: ids.filter((id) => Types.ObjectId.isValid(id)) } })
      .select('business_name')
      .lean();
    const byId = new Map(names.map((b) => [String(b._id), b.business_name]));
    for (const d of docs) {
      const id = String(d.business?._id ?? d.business);
      d.business = { _id: id, business_name: byId.get(id) ?? '' };
    }
  }

  private toCandidate(p: PoolProduct): Candidate {
    const vendorId = String(p.business?._id ?? p.business);
    const taxonomy = p.clothing?.taxonomy ?? {};
    const category = taxonomy.categories?.[0] || taxonomy.product_type || '';
    return {
      look: {
        id: String(p._id),
        kind: 'product',
        name: p.name || p.clothing?.name || '',
        image: p.clothing?.images?.[0]?.url || '',
        label: category,
        vendor: { id: vendorId, name: p.business?.business_name ?? '' },
      },
      vendorKey: vendorId,
      categoryKey: category || undefined,
    };
  }

  private async withVectors(candidates: Candidate[]): Promise<Candidate[]> {
    const ids = candidates.filter((c) => c.look.kind === 'product').map((c) => c.look.id);
    if (!ids.length) return candidates;
    const items: any[] = await this.catalogModel
      .find({ itemId: { $in: ids } })
      .select('itemId embeddings.e_style')
      .lean();
    const byId = new Map(items.map((i) => [i.itemId, i.embeddings?.e_style ?? null]));
    return candidates.map((c) => ({ ...c, vector: byId.get(c.look.id) ?? null }));
  }

  private styleQuery(gender: OnboardingGender) {
    return {
      business: null,
      is_active: true,
      image_url: { $exists: true, $nin: [null, ''] },
      gender: { $in: [gender, 'unisex'] },
      category: { $in: LOOK_STYLE_CATEGORIES },
    };
  }

  /** Platform styles as looks: whole outfits first, then skirts and trousers. */
  private async styleCandidates(gender: OnboardingGender, search?: RegExp | null): Promise<Candidate[]> {
    const styles: any[] = await this.styleModel
      .find({
        ...this.styleQuery(gender),
        ...(search ? { $or: [{ name: search }, { aliases: search }, { attributes: search }] } : {}),
      })
      .select('name category image_url attributes')
      .lean();
    const rank = (s: any) => LOOK_STYLE_CATEGORIES.indexOf(s.category);
    return shuffle(styles)
      .sort((a, b) => rank(a) - rank(b))
      .map((s) => this.styleCandidate(s));
  }

  private styleCandidate(s: any): Candidate {
    return {
      look: {
        id: String(s._id),
        kind: 'style',
        name: s.name,
        image: s.image_url,
        label: s.name,
        vendor: null,
      },
      // Spread across categories; whole outfits may fill most of the screen.
      categoryKey: s.category === 'full_body' ? undefined : s.category,
    };
  }

  private async similarStyles(
    id: string,
    gender: OnboardingGender,
    exclude: Set<string>,
    limit: number,
  ): Promise<Look[]> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid look');
    const target: any = await this.styleModel.findById(id).select('category attributes').lean();
    if (!target) return [];
    const attrs = new Set<string>((target.attributes ?? []).map((a: string) => a.toLowerCase()));
    const styles: any[] = await this.styleModel
      .find(this.styleQuery(gender))
      .select('name category image_url attributes')
      .lean();
    return shuffle(styles.filter((s) => !exclude.has(String(s._id))))
      .map((s) => ({
        s,
        score:
          (s.category === target.category ? 2 : 0) +
          (s.attributes ?? []).filter((a: string) => attrs.has(a.toLowerCase())).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => this.styleCandidate(x.s).look);
  }
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(Number(n)) ? Number(n) : min));

/** A case-insensitive "contains" match for a search box, or null when empty. */
const searchRegex = (q?: string): RegExp | null => {
  const s = String(q ?? '').trim().slice(0, 60);
  return s ? new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
};

const unique = (ids: string[]) => [...new Set((ids ?? []).map((x) => String(x).trim()).filter(Boolean))];

const sameCategoryBonus = (a: Candidate, b: Candidate) =>
  a.categoryKey && b.categoryKey && a.categoryKey.toLowerCase() === b.categoryKey.toLowerCase() ? 0.05 : 0;
