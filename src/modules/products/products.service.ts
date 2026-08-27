// product.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  Accessory,
  AccessoryDocument,
  Fabric,
  FabricDocument,
  Product,
  ProductDocument,
} from './schemas';
import { CreateProductDto } from './dto';
import { Utils } from '../../common/utils/pagination';
import { percentageChange } from '../../common/utils/percentageChange';
import { ClothingType } from './dto/clothing.dto';
import { ProductStatus } from './enums/product-status.enum';
import { ProductModerationStatus } from './enums/product-moderation.enum';

import { User, UserDocument } from '../ums/schemas';
import { UserType } from '../ums/schemas/user.schema';
import { Cron } from '@nestjs/schedule';
import {
  Order,
  OrderDocument,
  OrderItem,
} from '../orders/schemas/orders.schema';
import { UpdateAccessoryVariantStockDto } from './dto/accessory.dto';
import { FindAllProductsDto } from './dto/find-all-products.dto';
import {
  AdminFindProductsDto,
  AdminUpdateProductDto,
} from './dto/admin-products.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import {
  withAvailability,
  computeAvailability,
  StockThresholds,
} from './product-availability';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Accessory.name)
    private readonly accessoryModel: Model<AccessoryDocument>,
    @InjectModel(Fabric.name)
    private readonly fabricModel: Model<FabricDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectConnection() private readonly connection: Connection,
    private eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * After an order deducts stock, alert the vendor about any of their products
   * that are now low or out of stock. De-duped per product (via createUnique) so
   * a product that stays low doesn't fire on every subsequent sale.
   */
  private async notifyLowStock(productIds: string[]): Promise<void> {
    try {
      const ids = [...new Set(productIds.filter(Boolean))];
      if (!ids.length) return;
      const thresholds = await this.getStockThresholds();
      const products = await this.productModel
        .find({ _id: { $in: ids } })
        .lean();

      for (const p of products) {
        const avail = computeAvailability(p, thresholds);
        if (avail.state !== 'low_stock' && avail.state !== 'out_of_stock')
          continue;

        const business = await this.businessModel
          .findById((p as any).business)
          .select('created_by')
          .lean();
        const recipient = (business as any)?.created_by?.id?.toString();
        if (!recipient) continue;

        const name =
          (p as any).clothing?.name ??
          (p as any).accessory?.name ??
          (p as any).fabric?.name ??
          'A product';
        const out = avail.state === 'out_of_stock';

        await this.notificationsService.createUnique({
          recipient,
          recipient_business: (p as any).business?.toString?.(),
          category: NotificationCategory.PRODUCT,
          type: NotificationType.LOW_STOCK,
          title: out ? 'Out of stock ⚠️' : 'Low stock ⚠️',
          body: out
            ? `${name} is now out of stock — restock to keep selling.`
            : `${name} is running low on stock.`,
          metadata: { product_id: (p as any)._id, state: avail.state },
          action_url: '/products',
        });
      }
    } catch (err: any) {
      this.logger.warn(`Low-stock notification failed: ${err.message}`);
    }
  }

  /** Stock thresholds from platform settings (with sane fallbacks). */
  private async getStockThresholds(): Promise<StockThresholds> {
    const s = await this.platformSettingsModel
      .findOne()
      .lean()
      .catch(() => null);
    return {
      lowStock: (s as any)?.low_stock_threshold ?? 5,
      lowFabricYards: (s as any)?.low_fabric_yards ?? 0,
    };
  }

  /** A product by id with its computed `availability` (for the PDP). */
  async findByIdWithAvailability(id: string): Promise<any> {
    const [product, thresholds] = await Promise.all([
      this.findById(id),
      this.getStockThresholds(),
    ]);
    // Customer-facing PDP: a draft/archived product, or one from an unapproved
    // vendor, must not be viewable — treat it as not found.
    await this.assertPubliclyVisible(product);
    return withAvailability(product, thresholds);
  }

  /**
   * Distinct business IDs that have at least one ACTIVE product matching the
   * given search term (name / category / attributes). Mirrors the product
   * search used by findAll, so the vendor search on the shop returns the same
   * vendors whose items show up in the results.
   */
  async findBusinessIdsBySearch(search: string): Promise<Types.ObjectId[]> {
    const term = search?.trim();
    if (!term) return [];
    // Same tokenized/synonym/typo-tolerant matching as the product search.
    const searchClause = this.buildSearchClause(term);
    if (!searchClause) return [];
    const ids = await this.productModel.distinct('business', {
      status: ProductStatus.ACTIVE,
      ...searchClause,
    });
    const approved = new Set(
      (await this.getApprovedBusinessIds()).map((x) => x.toString()),
    );
    return (ids as Types.ObjectId[]).filter((id) =>
      approved.has(id.toString()),
    );
  }

  /**
   * Business ids that are approved to sell — only their products may be shown to
   * customers. Approved = status ∈ {approved, verified} and not deactivated.
   * Every public/customer product query gates on this so products from
   * pending / in-review / rejected / deactivated vendors never surface.
   */
  private async getApprovedBusinessIds(): Promise<Types.ObjectId[]> {
    const ids = await this.businessModel.distinct('_id', {
      status: { $in: ['approved', 'verified'] },
      is_active: { $ne: false },
    });
    return ids as unknown as Types.ObjectId[];
  }

  /**
   * Guard a single product for customer-facing exposure (PDP): it must be ACTIVE
   * and belong to an approved vendor, otherwise it is treated as not found.
   * findById itself stays ungated so internal callers can resolve any product.
   */
  private async assertPubliclyVisible(product: any): Promise<void> {
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not found');
    }
    if (product.moderation?.status === ProductModerationStatus.REJECTED) {
      throw new NotFoundException('Product not found');
    }
    const bizId = (product.business as any)?._id ?? product.business;
    const biz = await this.businessModel
      .findById(bizId)
      .select('status is_active')
      .lean();
    const approved =
      !!biz &&
      ['approved', 'verified'].includes((biz as any).status) &&
      (biz as any).is_active !== false;
    if (!approved) throw new NotFoundException('Product not found');
  }

  /**
   * Of the given business IDs, the distinct ones that currently have at least
   * one ACTIVE product with a discount applied — used to flag vendors that have
   * live deals on storefront/vendor cards.
   */
  async findBusinessIdsWithActiveDiscounts(
    businessIds: (Types.ObjectId | string)[],
  ): Promise<string[]> {
    if (!businessIds?.length) return [];
    const ids = businessIds.map((b) => new Types.ObjectId(String(b)));
    const result = await this.productModel.distinct('business', {
      business: { $in: ids },
      status: ProductStatus.ACTIVE,
      applied_discount: { $ne: null },
    });
    return result.map((r) => String(r));
  }

  /**
   * Count ACTIVE products per business, for the given business ids.
   * Returns a map of businessId → active-product count (missing = 0).
   * Used by the public vendor list so the storefront can hide empty shops.
   */
  async countActiveByBusinessIds(
    businessIds: (Types.ObjectId | string)[],
  ): Promise<Record<string, number>> {
    if (!businessIds?.length) return {};
    const ids = businessIds.map((b) => new Types.ObjectId(String(b)));
    const rows = await this.productModel.aggregate([
      { $match: { business: { $in: ids }, status: ProductStatus.ACTIVE } },
      { $group: { _id: '$business', count: { $sum: 1 } } },
    ]);
    const map: Record<string, number> = {};
    for (const r of rows) map[String(r._id)] = r.count;
    return map;
  }

  /**
   * Computed vendor rating per business, for the given business ids: the mean of
   * ALL individual product ratings (sum of rating values / number of ratings)
   * across the vendor's active products — the same formula as the single-vendor
   * storefront profile. Used so vendor cards in lists show a real rating.
   * Returns a map of businessId → { average (1dp), count }.
   */
  async getRatingsByBusinessIds(
    businessIds: (Types.ObjectId | string)[],
  ): Promise<Record<string, { average: number; count: number }>> {
    if (!businessIds?.length) return {};
    const ids = businessIds.map((b) => new Types.ObjectId(String(b)));
    const rows = await this.productModel.aggregate([
      { $match: { business: { $in: ids }, status: ProductStatus.ACTIVE } },
      {
        $group: {
          _id: '$business',
          sum: { $sum: { $sum: '$ratings.value' } },
          count: { $sum: { $size: { $ifNull: ['$ratings', []] } } },
        },
      },
    ]);
    const map: Record<string, { average: number; count: number }> = {};
    for (const r of rows) {
      map[String(r._id)] = {
        average: r.count > 0 ? Math.round((r.sum / r.count) * 10) / 10 : 0,
        count: r.count,
      };
    }
    return map;
  }

  /**
   * Create a product and compute its price dynamically based on type
   */
  async upsert(
    dto: CreateProductDto,
    business: Types.ObjectId,
    kind: string,
  ): Promise<{ data: ProductDocument; message: string }> {
    // 1. Determine base price
    let totalPrice = dto.base_price;
    
    // Fallback if frontend hasn't updated to send base_price directly yet
    if (totalPrice === undefined || totalPrice === null) {
       if (dto.metafields?.base_price) {
           totalPrice = Number(dto.metafields.base_price);
       } else if (kind === 'accessory') {
           totalPrice = (dto as any).accessory?.price || 0;
       } else if (kind === 'fabric') {
           const f = (dto as any).fabric;
           totalPrice = (f?.price_per_yard || 0) * Math.max(f?.yard_length || 0, f?.min_cut || 0);
       } else {
           totalPrice = 0; 
       }
    }
    if (dto.product_id) {
      const existing = await this.productModel.findById(dto.product_id);

      if (existing) {
        if (existing.business.toString() !== business.toString()) {
          throw new ForbiddenException(
            'You do not have permission to update this product',
          );
        }

        const { product_id, ...safeData } = dto;

        Object.assign(existing, {
          ...safeData,
          base_price: totalPrice,
          kind,
        });

        await existing.save();

        // Sync to recommendation catalog
        this.eventEmitter.emit('product.upserted', existing.toObject());

        return {
          data: existing.toObject(),
          message: 'Product updated successfully',
        };
      }
    }

    // 3. Otherwise create new product
    const created = await this.productModel.create({
      ...dto,
      business,
      kind,
      base_price: totalPrice,
    });

    // Sync to recommendation catalog
    this.eventEmitter.emit('product.upserted', created.toObject());

    return {
      data: created.toObject(),
      message: 'Product created successfully',
    };
  }

  /**
   * Get all products
   */
  /** Fashion-domain synonyms so "gown" finds dresses, "pants" finds trousers, etc. */
  private static readonly SEARCH_SYNONYMS: Record<string, string[]> = {
    dress: ['gown'], gown: ['dress'],
    trousers: ['trouser', 'pants', 'pant'], trouser: ['trousers', 'pants', 'pant'],
    pants: ['trousers', 'trouser', 'pant'], pant: ['pants', 'trousers', 'trouser'],
    top: ['blouse'], blouse: ['top', 'shirt'], shirt: ['top', 'blouse'],
    agbada: ['babariga', 'boubou'], kaftan: ['caftan'], caftan: ['kaftan'],
    ankara: ['wax'], sneakers: ['sneaker', 'trainers'], sneaker: ['sneakers', 'trainers'],
    bag: ['purse', 'handbag'], purse: ['bag', 'handbag'], handbag: ['bag', 'purse'],
    jacket: ['blazer', 'coat'], blazer: ['jacket'], coat: ['jacket'],
    skirt: ['skirts'], shoes: ['shoe', 'footwear'], shoe: ['shoes', 'footwear'],
  };

  private static escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Build a MongoDB clause for a free-text product search that is:
   *  • word-order independent — each token must appear somewhere (so "silk
   *    agbada" matches "Agbada in Silk"),
   *  • synonym-aware (gown↔dress, pants↔trousers, kaftan↔caftan, …),
   *  • lightly typo-tolerant — one wrong letter on longer tokens
   *    (e.g. "agbida" still finds "agbada"),
   *  • regex-safe — user input is escaped so special chars can't break or abuse
   *    the query.
   * Comprehensive fuzzy matching (insertions/deletions/transpositions) belongs
   * in Atlas Search's `fuzzy` operator — a good follow-up, like the vector index.
   */
  private buildSearchClause(search: string): any | null {
    const tokens = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    const fields = [
      'clothing.name', 'accessory.name', 'fabric.name',
      'clothing.taxonomy.categories', 'accessory.taxonomy.categories', 'fabric.taxonomy.categories',
      'clothing.taxonomy.attributes', 'accessory.taxonomy.attributes', 'fabric.taxonomy.attributes',
    ];

    const perToken = tokens.map((token) => {
      const variants = new Set<string>();
      variants.add(ProductService.escapeRegex(token));
      for (const syn of ProductService.SEARCH_SYNONYMS[token] ?? []) {
        variants.add(ProductService.escapeRegex(syn));
      }
      // Single-substitution typo tolerance for longer tokens: replace each
      // position with a wildcard so one wrong letter still matches.
      if (token.length >= 5 && token.length <= 20) {
        for (let i = 0; i < token.length; i++) {
          variants.add(
            ProductService.escapeRegex(token.slice(0, i)) + '.' + ProductService.escapeRegex(token.slice(i + 1)),
          );
        }
      }
      const rx = { $regex: `(?:${[...variants].join('|')})`, $options: 'i' };
      return { $or: fields.map((f) => ({ [f]: rx })) };
    });

    // Every token must match somewhere → order-independent AND across tokens.
    return perToken.length === 1 ? perToken[0] : { $and: perToken };
  }

  async findAll(dto: FindAllProductsDto) {
    const {
      page = 1,
      size = 10,
      kind,
      search,
      status,
      sortBy,
      order = 'desc',
      business_id,
      product_type,
      category,
      audience,
      minPrice,
      maxPrice,
      on_sale,
      in_stock,
      type,
    } = dto;

    const filter: any = {};

    // Public/customer catalog. ONLY active products from APPROVED vendors are
    // ever visible:
    //  • status is forced to ACTIVE — the incoming `status` param is ignored so
    //    it can't be abused (?status=draft) to surface unpublished products.
    //  • the vendor-approval gate hides products from pending / in-review /
    //    rejected / deactivated vendors, even when a specific business_id is
    //    requested (an unapproved vendor's storefront then returns nothing).
    // Vendors view their own drafts via the @Roles(VENDOR) findByVendor path,
    // which is unaffected by this.
    filter.status = ProductStatus.ACTIVE;
    filter.business = { $in: await this.getApprovedBusinessIds() };
    // A listing the admin rejected stays out of the catalogue regardless of the
    // status the vendor sets. Legacy documents have no moderation field at all,
    // so match on "not rejected" rather than "approved".
    filter['moderation.status'] = { $ne: ProductModerationStatus.REJECTED };

    if (kind) {
      filter.kind = kind;
    }

    // 🏷️ TAXONOMY FILTERS
    if (product_type) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { 'clothing.taxonomy.product_type': product_type },
        { 'accessory.taxonomy.product_type': product_type },
        { 'fabric.taxonomy.product_type': product_type },
      );
    }

    if (category) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { 'clothing.taxonomy.categories': category },
        { 'accessory.taxonomy.categories': category },
        { 'fabric.taxonomy.categories': category },
      );
    }

    if (audience) {
      // Bidirectional synonym map: male↔men, female↔women
      const synonymMap: Record<string, string> = { male: 'men', female: 'women', men: 'male', women: 'female' };
      const matchValues = [audience, 'unisex', ...(synonymMap[audience] ? [synonymMap[audience]] : [])];
      const audienceMatch = { $in: matchValues };
      filter.$or = filter.$or || [];
      filter.$or.push(
        { 'clothing.taxonomy.audience': audienceMatch },
        { 'accessory.taxonomy.audience': audienceMatch },
        { 'fabric.taxonomy.audience': audienceMatch },
        // Only match untagged products against their own kind
        { kind: 'clothing', 'clothing.taxonomy.audience': { $exists: false } },
        { kind: 'accessory', 'accessory.taxonomy.audience': { $exists: false } },
        { kind: 'fabric', 'fabric.taxonomy.audience': { $exists: false } },
      );
    }

    // 🔍 SEARCH
    if (search) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { 'clothing.name': { $regex: search, $options: 'i' } },
        { 'accessory.name': { $regex: search, $options: 'i' } },
        { 'fabric.name': { $regex: search, $options: 'i' } },

        { 'clothing.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'accessory.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'fabric.taxonomy.categories': { $regex: search, $options: 'i' } },

        { 'clothing.taxonomy.attributes': { $regex: search, $options: 'i' } },
        { 'accessory.taxonomy.attributes': { $regex: search, $options: 'i' } },
        { 'fabric.taxonomy.attributes': { $regex: search, $options: 'i' } },
      );
    }

    // ⚠️ MongoDB requires $and if we push multiple $or arrays, so we must combine them correctly if multiple exist.
    // Let's refactor the $or combinations.
    const andClauses: any[] = [];

    if (business_id) {
      andClauses.push({
        $or: [
          { business: new Types.ObjectId(business_id) },
          { business: business_id },
        ],
      });
    }

    if (product_type) {
      andClauses.push({
        $or: [
          { 'clothing.taxonomy.product_type': product_type },
          { 'accessory.taxonomy.product_type': product_type },
          { 'fabric.taxonomy.product_type': product_type },
        ],
      });
    }

    if (category) {
      andClauses.push({
        $or: [
          { 'clothing.taxonomy.categories': category },
          { 'accessory.taxonomy.categories': category },
          { 'fabric.taxonomy.categories': category },
        ],
      });
    }

    if (audience) {
      // Bidirectional synonym map: male↔men, female↔women
      const synonymMap: Record<string, string> = { male: 'men', female: 'women', men: 'male', women: 'female' };
      const matchValues = [audience, 'unisex', ...(synonymMap[audience] ? [synonymMap[audience]] : [])];
      const audienceMatch = { $in: matchValues };
      andClauses.push({
        $or: [
          { 'clothing.taxonomy.audience': audienceMatch },
          { 'accessory.taxonomy.audience': audienceMatch },
          { 'fabric.taxonomy.audience': audienceMatch },
          // Only match untagged products against their own kind
          { kind: 'clothing', 'clothing.taxonomy.audience': { $exists: false } },
          { kind: 'accessory', 'accessory.taxonomy.audience': { $exists: false } },
          { kind: 'fabric', 'fabric.taxonomy.audience': { $exists: false } },
        ],
      });
    }

    if (search) {
      // Tokenized, synonym-aware, lightly typo-tolerant, regex-safe search.
      const searchClause = this.buildSearchClause(search);
      if (searchClause) andClauses.push(searchClause);
    }

    // 🏷️ ON SALE — a real discounted price below base (matches the shop's
    // hasDiscount: discounted_price > 0 AND < base_price). Some products set the
    // sale price without a percentage, so key off the price, not the percentage.
    if (on_sale) {
      andClauses.push({
        $expr: {
          $and: [
            { $gt: ['$discounted_price', 0] },
            { $lt: ['$discounted_price', '$base_price'] },
          ],
        },
      });
    }

    // 👗 CLOTHING TYPE — 'customize' | 'non_customize'.
    if (type) {
      filter['clothing.type'] = type;
    }

    // 💰 PRICE RANGE — filter on the EFFECTIVE price (discounted_price when set
    // and > 0, otherwise base_price). Pushed as $and clauses so they never
    // clobber the taxonomy/search $or arrays.
    if (minPrice !== undefined || maxPrice !== undefined) {
      const effPrice = {
        $cond: [{ $gt: ['$discounted_price', 0] }, '$discounted_price', '$base_price'],
      };
      if (minPrice !== undefined) {
        andClauses.push({ $expr: { $gte: [effPrice, minPrice] } });
      }
      if (maxPrice !== undefined) {
        andClauses.push({ $expr: { $lte: [effPrice, maxPrice] } });
      }
    }

    // 📦 IN STOCK — mirror product-availability.ts stock rules per kind.
    if (in_stock) {
      andClauses.push({
        $or: [
          // Customize clothing is made-to-order → always available.
          { $and: [{ kind: 'clothing' }, { 'clothing.type': 'customize' }] },
          // Non-customize clothing with at least one variant in stock.
          { 'clothing.color_variants.variants.stock': { $gt: 0 } },
          // Accessory with per-variant stock.
          { 'accessory.variants.stock': { $gt: 0 } },
          // Accessory base item flagged in stock.
          { $and: [{ 'accessory.in_stock': true }] },
          // Fabric with enough remaining yardage to cut the minimum.
          { $expr: { $and: [
            { $gt: [{ $ifNull: ['$fabric.yard_length', 0] }, 0] },
            { $gte: [{ $ifNull: ['$fabric.yard_length', 0] }, { $ifNull: ['$fabric.min_cut', 0] }] },
          ] } },
        ],
      });
    }

    if (andClauses.length > 0) {
      filter.$and = andClauses;
    }

    // Remove the old direct filter.$or as we've moved everything to $and
    delete filter.$or;

    const { take, skip } = await Utils.getPagination(page, size);

    // 🔃 SORT
    const sortOrder = order === 'asc' ? 1 : -1;
    let sort: Record<string, 1 | -1> = { createdAt: -1 };

    switch (sortBy) {
      case 'rating':
        sort = { average_rating: sortOrder };
        break;
      case 'date':
        sort = { createdAt: sortOrder };
        break;
      case 'price':
        sort = { base_price: sortOrder };
        break;
      case 'relevance':
        sort = search
          ? { average_rating: -1, createdAt: -1 }
          : { createdAt: -1 };
        break;
    }

    const [rows, count] = await Promise.all([
      this.productModel
        .find(filter)
        .populate('business', 'business_name business_logo_url business_logo_svg_url cover_image_url theme_color description')
        .sort(sort)
        .skip(skip)
        .limit(take)
        .exec(),

      this.productModel.countDocuments(filter),
    ]);

    // Attach per-product availability so listings can badge/demote sold-out
    // items and the shop can offer an "in stock only" filter.
    const thresholds = await this.getStockThresholds();
    const withAvail = rows.map((r) => withAvailability(r, thresholds));

    return Utils.getPagingData({ rows: withAvail, count }, page, size);
  }

  // trending this week, top vendors, new vendors
  /**
   * Get a product by ID
   */
  async findById(id: string): Promise<ProductDocument> {
    const product = await this.productModel
      .findById(id)
      .populate('business', 'business_name business_logo_url business_logo_svg_url cover_image_url theme_color description')
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /**
   * Delete a product
   */
  /**
   * A vendor "deleting" a product archives it; an admin removes the document.
   *
   * The unrecognised-type branch throws rather than falling through to the
   * not-found message below. That fall-through is what hid two separate bugs
   * for as long as it did: UserType.ADMIN is the string 'platform', not
   * 'admin', and the caller was reading `req.user.user_type` where the schema
   * field is `type` — so `userType` arrived undefined, matched nothing, and
   * every delete reported "product not found" instead of saying it had no idea
   * who was asking.
   */
  async delete(id: string, userId: string, userType: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid product id');
    }

    const isVendor = userType === UserType.VENDOR;
    const isAdmin = userType === UserType.ADMIN || userType === 'admin';

    if (!isVendor && !isAdmin) {
      throw new ForbiddenException(
        `Unrecognised user type "${userType}" — cannot delete a product`,
      );
    }

    const result = isVendor
      ? await this.productModel.findOneAndUpdate(
          { _id: new Types.ObjectId(id) },
          { $set: { status: ProductStatus.ARCHIVED } },
          { new: true },
        )
      : await this.productModel.findOneAndDelete({
          _id: new Types.ObjectId(id),
        });

    if (!result) {
      throw new NotFoundException(
        'Product not found or you do not have permission to delete this product',
      );
    }
  }



  // 💰 Helper methods



  async findByVendor(
    vendor: string,
    kind: string,
    page: number = 1,
    size: number = 10,
  ) {
    const filter: any = {
      $or: [
        { business: new Types.ObjectId(vendor) },
        { business: vendor },
      ],
    };
    if (kind) {
      filter.kind = kind;
    }
    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.productModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }
  async getLatestProducts(page: number = 1, size: number = 10) {
    const { take, skip } = await Utils.getPagination(page, size);
    const [rows, count] = await Promise.all([
      this.productModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .populate('business', 'business_name business_logo_url')
        .select('kind base_price average_rating business')
        .exec(),
      this.productModel.countDocuments(),
    ]);

    const products = rows.map((p) => ({
      id: p._id,
      kind: p.kind,
      base_price: p.base_price,
      average_rating: p.average_rating,
      business: p.business,
    }));
    return Utils.getPagingData({ count, rows: products }, page, size);
  }
  async rateProduct(
    productId: string,
    userId: string,
    value: number,
    comment?: string,
  ): Promise<ProductDocument> {
    if (value < 1 || value > 5) {
      throw new BadRequestException('Rating value must be between 1 and 5');
    }

    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Verify the customer has purchased this product in a completed order
    const hasPurchased = await this.orderModel.exists({
      customer: new Types.ObjectId(userId),
      'items.product': new Types.ObjectId(productId),
      status: { $in: ['completed', 'delivered'] },
    });

    if (!hasPurchased) {
      throw new BadRequestException(
        'You can only review products you have purchased and received.',
      );
    }

    const existingRating = product.ratings.find((r) =>
      r.user.equals(new Types.ObjectId(userId)),
    );

    if (existingRating) {
      existingRating.value = value;
      existingRating.comment = comment;
    } else {
      product.ratings.push({
        user: new Types.ObjectId(userId),
        value,
        comment,
      });
    }

    // Recalculate average rating
    const totalRatings = product.ratings.length;
    const totalValue = product.ratings.reduce((sum, r) => sum + r.value, 0);
    product.average_rating = parseFloat((totalValue / totalRatings).toFixed(1));

    await product.save();

    return product;
  }
  async getProductRating(productId: string) {
    const product = await this.productModel
      .findById(productId)
      .select('average_rating ratings')
      .populate('ratings.user', 'name email');

    if (!product) throw new NotFoundException('Product not found');

    // Units delivered = total quantity of this product across delivered/completed
    // orders (summed over the per-item selection arrays).
    const soldAgg = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'delivered'] },
          'items.product': new Types.ObjectId(productId),
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.product': new Types.ObjectId(productId) } },
      {
        $group: {
          _id: null,
          units: {
            $sum: {
              $add: [
                { $sum: '$items.color_variant_selections.quantity' },
                { $sum: '$items.fabric_selections.quantity' },
                { $sum: '$items.accessory_selections.quantity' },
              ],
            },
          },
          lines: { $sum: 1 },
        },
      },
    ]);
    const agg = soldAgg[0];
    // Fall back to the line count if selections carried no quantity.
    const items_sold = agg ? agg.units || agg.lines || 0 : 0;

    return {
      average: product.average_rating,
      total_reviews: product.ratings.length,
      items_sold,
      ratings: product.ratings,
    };
  }

  /**
   * Get all reviews across all products for a specific vendor, paginated.
   * Uses $unwind to flatten the embedded ratings array.
   */
  async getVendorReviews(
    businessId: string,
    page = 1,
    size = 20,
    sortBy: 'recent' | 'highest' | 'lowest' = 'recent',
  ) {
    return this.reviewsFor(
      { business: new Types.ObjectId(businessId), 'ratings.0': { $exists: true } },
      page,
      size,
      sortBy,
    );
  }

  /**
   * The reviews left on ONE product, in the same shape as a vendor's — summary
   * buckets, a page of rows and its pagination — so the console's reviews
   * drawer renders either without knowing which it was given.
   *
   * GET /products/{id}/ratings already exists but answers a different question:
   * it is the storefront's rating summary (average, count, items sold) with no
   * buckets, no reviewer and no pagination.
   */
  async getProductReviews(
    productId: string,
    page = 1,
    size = 20,
    sortBy: 'recent' | 'highest' | 'lowest' = 'recent',
  ) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new BadRequestException('Invalid product id');
    }
    return this.reviewsFor(
      { _id: new Types.ObjectId(productId) },
      page,
      size,
      sortBy,
    );
  }

  /**
   * Ratings live embedded on products, so "a vendor's reviews" and "a product's
   * reviews" are the same unwind-and-bucket pipeline over a different set of
   * products. Only the $match differs.
   */
  private async reviewsFor(
    match: Record<string, unknown>,
    page = 1,
    size = 20,
    sortBy: 'recent' | 'highest' | 'lowest' = 'recent',
  ) {
    const skip = (page - 1) * size;

    const sortStage: Record<string, 1 | -1> =
      sortBy === 'highest'
        ? { 'ratings.value': -1 }
        : sortBy === 'lowest'
          ? { 'ratings.value': 1 }
          : { 'ratings._id': -1 }; // recent (default, by ObjectId descending)

    const pipeline: any[] = [
      { $match: match },
      { $unwind: '$ratings' },
      {
        $lookup: {
          from: 'users',
          localField: 'ratings.user',
          foreignField: '_id',
          as: 'ratings.user_info',
        },
      },
      { $unwind: { path: '$ratings.user_info', preserveNullAndEmptyArrays: true } },
      { $sort: sortStage },
      {
        $facet: {
          reviews: [
            { $skip: skip },
            { $limit: size },
            {
              $project: {
                _id: 0,
                product_id: '$_id',
                product_name: { $ifNull: ['$clothing.name', { $ifNull: ['$fabric.name', '$accessory.name'] }] },
                product_kind: '$kind',
                rating: '$ratings.value',
                comment: '$ratings.comment',
                reviewer: {
                  _id: '$ratings.user_info._id',
                  name: '$ratings.user_info.name',
                  email: '$ratings.user_info.email',
                },
                // A rating carries no timestamp of its own, so it comes from
                // its ObjectId. Legacy entries saved before subdocument ids get
                // null rather than failing $toDate for the whole pipeline —
                // this mirrors the customer-reviews projection.
                created_at: {
                  $cond: [
                    { $eq: [{ $type: '$ratings._id' }, 'objectId'] },
                    { $toDate: '$ratings._id' },
                    null,
                  ],
                },
              },
            },
          ],
          summary: [
            {
              $group: {
                _id: null,
                total_reviews: { $sum: 1 },
                average_rating: { $avg: '$ratings.value' },
                five_star: { $sum: { $cond: [{ $eq: ['$ratings.value', 5] }, 1, 0] } },
                four_star: { $sum: { $cond: [{ $eq: ['$ratings.value', 4] }, 1, 0] } },
                three_star: { $sum: { $cond: [{ $eq: ['$ratings.value', 3] }, 1, 0] } },
                two_star: { $sum: { $cond: [{ $eq: ['$ratings.value', 2] }, 1, 0] } },
                one_star: { $sum: { $cond: [{ $eq: ['$ratings.value', 1] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ];

    const [result] = await this.productModel.aggregate(pipeline);

    // $facet yields no document at all when the match selects nothing, so a
    // product with no ratings would have thrown on `result.summary`.
    const summary = result?.summary?.[0] || {
      total_reviews: 0,
      average_rating: 0,
      five_star: 0,
      four_star: 0,
      three_star: 0,
      two_star: 0,
      one_star: 0,
    };

    return {
      summary: {
        ...summary,
        average_rating: Math.round((summary.average_rating || 0) * 10) / 10,
      },
      reviews: result?.reviews ?? [],
      pagination: {
        page,
        size,
        total: summary.total_reviews,
        pages: Math.ceil(summary.total_reviews / size),
      },
    };
  }
  async toggleWishlist(userId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new BadRequestException('Invalid product ID');
    }

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    const oid = new Types.ObjectId(productId);

    // Try to remove first (atomic, no version conflict)
    const pullResult = await this.userModel.updateOne(
      { _id: userId, wishlist: oid },
      { $pull: { wishlist: oid } },
    );

    if (pullResult.modifiedCount > 0) {
      // Was in wishlist → removed
      const user = await this.userModel.findById(userId).select('wishlist').lean();
      return {
        message: 'Product removed from wishlist',
        data: user?.wishlist || [],
      };
    }

    // Not in wishlist → add
    await this.userModel.updateOne(
      { _id: userId },
      { $addToSet: { wishlist: oid } },
    );
    const user = await this.userModel.findById(userId).select('wishlist').lean();
    return { message: 'Product added to wishlist', data: user?.wishlist || [] };
  }

  async getCustomizableWishlist(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .populate({
        path: 'wishlist',
        match: {
          kind: 'clothing',
          'clothing.type': ClothingType.CUSTOMIZE,
          status: 'active',
        },
      })
      .select('wishlist');

    if (!user) throw new NotFoundException('User not found');

    // Drop wishlisted items whose vendor is no longer approved.
    const approved = new Set(
      (await this.getApprovedBusinessIds()).map((x) => x.toString()),
    );
    return ((user.wishlist as any[]) || []).filter((p) => {
      const bizId = ((p?.business as any)?._id ?? p?.business)?.toString();
      return bizId && approved.has(bizId);
    });
  }

  async getTrendingProductsThisWeek() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const trendingProducts = await this.productModel.aggregate([
      {
        $match: {
          status: 'active', // only active products
          createdAt: { $lte: new Date() },
        },
      },
      {
        $addFields: {
          recent_ratings: {
            $filter: {
              input: { $ifNull: ['$ratings', []] },
              as: 'r',
              cond: { $gte: ['$$r.createdAt', sevenDaysAgo] }, // last 7 days
            },
          },
        },
      },
      {
        $addFields: {
          recent_ratings_count: { $size: '$recent_ratings' },
        },
      },
      {
        $sort: {
          average_rating: -1, // highest rated first
          recent_ratings_count: -1, // most engagement recently
          createdAt: -1, // newest first
        },
      },
      { $limit: 20 },
      {
        $lookup: {
          from: 'businesses',
          localField: 'business',
          foreignField: '_id',
          as: 'business',
        },
      },
      { $unwind: { path: '$business', preserveNullAndEmptyArrays: true } },
      // Only surface products from approved vendors.
      {
        $match: {
          'business.status': { $in: ['approved', 'verified'] },
          'business.is_active': { $ne: false },
        },
      },
      {
        $project: {
          id: '$_id',
          kind: 1,
          base_price: 1,
          average_rating: 1,
          createdAt: 1,
          business: {
            _id: '$business._id',
            business_name: '$business.business_name',
            business_logo_url: '$business.business_logo_url',
          },
        },
      },
    ]);

    return trendingProducts;
  }

  async updateStatus(
    productId: string,
    business: string,
    status: ProductStatus,
  ) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    if (product.business.toString() !== business.toString()) {
      throw new ForbiddenException(
        'You do not have permission to update this product',
      );
    }
    product.status = status;

    // If manually updated, clear scheduled activation
    product.scheduled_activation_date = undefined;

    const updatedProduct = await product.save();

    return {
      message: `Product status updated to ${status}`,
      data: updatedProduct.toJSON(),
    };
  }

  async scheduleActivation(
    productId: string,
    businessId: string,
    activationDate: Date,
  ) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    if (new Date(activationDate) <= new Date()) {
      throw new BadRequestException('Activation date must be in the future');
    }
    if (product.business.toString() != businessId) {
      throw new ForbiddenException(
        'You are not allowed to modify this product',
      );
    }
    product.scheduled_activation_date = activationDate;
    await product.save();

    return {
      message: 'Product scheduled for automatic activation',
      data: product.toJSON().scheduled_activation_date,
    };
  }
  // Runs every 1 minute
  @Cron('*/1 * * * *')
  async activateScheduledProducts() {
    const now = new Date();
    this.logger.log(
      `Running scheduled activation check at ${now.toISOString()}`,
    );

    const result = await this.productModel.updateMany(
      {
        scheduled_activation_date: { $lte: now },
        status: { $ne: ProductStatus.ACTIVE },
      },
      {
        $set: { status: ProductStatus.ACTIVE, scheduled_activation_date: null },
      },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Activated ${result.modifiedCount} product(s) scheduled for activation.`,
      );
    } else {
      this.logger.log('No products to activate at this time.');
    }
  }

  async updateInventory(orderId: Types.ObjectId) {
    const session = await this.connection.startSession();
    const deductedProductIds: string[] = [];

    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel.findById(orderId).session(session);

        if (!order?.items || order.items.length === 0) return;

        // Idempotency: a retried Paystack webhook can call this twice. Deduct
        // stock only once per order.
        if ((order as any).inventory_deducted) {
          this.logger.warn(
            `Inventory already deducted for order ${orderId} — skipping.`,
          );
          return;
        }

        for (const item of order.items) {
          if ((item as any).product) {
            deductedProductIds.push(String((item as any).product));
          }
          await this.updateFabric(item, session);
          await this.updateAccessory(item, session);
          await this.updateColorVariant(item, session);

          // Deduct applied fabric (from "Use Fabric" feature)
          if (item.applied_fabric && item.applied_fabric_yards) {
            const fabricProduct = await this.productModel
              .findById(item.applied_fabric)
              .session(session);
            if (fabricProduct?.fabric) {
              const newYards =
                fabricProduct.fabric.yard_length - item.applied_fabric_yards;
              if (newYards < 0) {
                throw new BadRequestException(
                  `Not enough applied fabric (${fabricProduct.fabric.name}) available`,
                );
              }
              fabricProduct.fabric.yard_length = newYards;
              await fabricProduct.save({ session });
              this.logger.log(
                `Applied fabric ${item.applied_fabric} deducted by ${item.applied_fabric_yards} yards`,
              );
            }
          }
        }

        // Mark deducted so a duplicate webhook can't deduct again.
        (order as any).inventory_deducted = true;
        await order.save({ session });
      });
      this.logger.log('INVENTORY UPDATED');

      // Post-commit (best-effort): alert vendors about now-low/out-of-stock
      // products. Outside the transaction so a notification hiccup can't roll
      // back the deduction, and only when we actually deducted this run.
      if (deductedProductIds.length) {
        await this.notifyLowStock(deductedProductIds);
      }
    } catch (err: any) {
      this.logger.error('updateInventory failed', err.stack || err.message);
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Restores inventory that was deducted when an order was placed.
   * Called on order cancellation, full refund, or vendor rejection.
   * Mirrors updateInventory() but adds stock back instead of deducting.
   */
  async restoreInventory(
    orderId: Types.ObjectId,
    businessId?: string | Types.ObjectId,
    itemId?: string | Types.ObjectId,
  ) {
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel.findById(orderId).session(session);

        if (!order?.items || order.items.length === 0) return;

        // Only restore what was actually deducted — and never restore twice.
        if (!(order as any).inventory_deducted) {
          this.logger.warn(
            `Inventory was not deducted for order ${orderId} — nothing to restore.`,
          );
          return;
        }

        // A vendor rejection / auto-reject restores only THAT vendor's items;
        // the rest of a multi-vendor order stays deducted. A full order
        // cancel/return passes no businessId and restores everything. A per-item
        // rejection additionally passes itemId to restore just that one line.
        let items = businessId
          ? order.items.filter(
              (i) => String((i as any).business) === String(businessId),
            )
          : order.items;
        if (itemId) {
          // Per-item restore: exactly this line (it is being rejected right now,
          // so its own `rejected` flag must NOT exclude it).
          items = items.filter(
            (i) => String((i as any)._id) === String(itemId),
          );
        } else {
          // Vendor/full restore: skip items already individually rejected — their
          // stock was restored when they were rejected, so restoring again would
          // double-count.
          items = items.filter((i) => !(i as any).rejected);
        }

        for (const item of items) {
          // Restore fabric yardage
          const fabricSelections = item.fabric_selections || [];
          for (const selection of fabricSelections) {
            const totalYards =
              (selection.yardage ?? 0) * (selection.quantity ?? 1);

            if (totalYards <= 0) continue;

            // Try standalone fabric first
            const standaloneFabric = await this.fabricModel
              .findById(selection.fabric_id)
              .session(session);

            if (standaloneFabric) {
              standaloneFabric.yard_length =
                (standaloneFabric.yard_length ?? 0) + totalYards;
              await standaloneFabric.save({ session });
              this.logger.log(
                `[RestoreInventory] Fabric ${selection.fabric_id} restored +${totalYards} yards`,
              );
            } else {
              // Try embedded fabric in clothing…
              const embeddedRes = await this.productModel.updateOne(
                {
                  _id: item.product,
                  'clothing.fabrics._id': selection.fabric_id,
                },
                {
                  $inc: { 'clothing.fabrics.$.yard_length': totalYards },
                },
                { session },
              );

              // …or the fabric-KIND product's own fabric (product.fabric).
              if (embeddedRes.matchedCount === 0) {
                await this.productModel.updateOne(
                  { _id: item.product, 'fabric._id': selection.fabric_id },
                  { $inc: { 'fabric.yard_length': totalYards } },
                  { session },
                );
              }
              this.logger.log(
                `[RestoreInventory] Embedded fabric ${selection.fabric_id} restored +${totalYards} yards`,
              );
            }
          }

          // Restore accessory variant stock
          const accessorySelections = item.accessory_selections || [];
          for (const selection of accessorySelections) {
            const totalQty = selection.quantity ?? 1;

            // Try standalone accessory
            const standalone = this.accessoryModel
              ? await this.accessoryModel
                  .findOne({
                    _id: selection.accessory_id,
                    'variants._id': selection.variant_id,
                  })
                  .session(session)
              : null;

            if (standalone) {
              await this.accessoryModel.updateOne(
                {
                  _id: selection.accessory_id,
                  'variants._id': selection.variant_id,
                },
                { $inc: { 'variants.$.stock': totalQty } },
                { session },
              );
              this.logger.log(
                `[RestoreInventory] Accessory variant ${selection.variant_id} stock +${totalQty}`,
              );
            } else {
              // Try embedded accessory (clothing.accessories)
              const embRes = await this.productModel.updateOne(
                {
                  _id: item.product,
                  'clothing.accessories._id': selection.accessory_id,
                  'clothing.accessories.variants._id': selection.variant_id,
                },
                {
                  $inc: {
                    'clothing.accessories.$[acc].variants.$[v].stock': totalQty,
                  },
                },
                {
                  arrayFilters: [
                    { 'acc._id': selection.accessory_id },
                    { 'v._id': selection.variant_id },
                  ],
                  session,
                },
              );

              if (embRes.modifiedCount > 0) {
                this.logger.log(
                  `[RestoreInventory] Embedded accessory variant ${selection.variant_id} stock +${totalQty}`,
                );
              } else {
                // Standalone accessory-KIND product: stock on product.accessory.
                await this.productModel.updateOne(
                  {
                    _id: item.product,
                    'accessory._id': selection.accessory_id,
                    'accessory.variants._id': selection.variant_id,
                  },
                  { $inc: { 'accessory.variants.$[v].stock': totalQty } },
                  {
                    arrayFilters: [{ 'v._id': selection.variant_id }],
                    session,
                  },
                );
                this.logger.log(
                  `[RestoreInventory] Accessory-kind variant ${selection.variant_id} stock +${totalQty}`,
                );
              }
            }
          }

          // Restore color variant stock
          const colorVariantSelections = item.color_variant_selections || [];
          if (colorVariantSelections.length > 0) {
            const product = await this.productModel
              .findById(item.product)
              .session(session);

            if (product) {
              const colorVariants =
                product.clothing?.color_variants || [];

              for (const selection of colorVariantSelections) {
                // `variant_id` is the INNER size-variant _id — find the colour
                // variant that contains it, then restore that variant's stock.
                let variant: any;
                let colorVariant: any;
                for (const cv of colorVariants) {
                  const match = cv.variants.find(
                    (v) => String(v._id) === String(selection.variant_id),
                  );
                  if (match) {
                    variant = match;
                    colorVariant = cv;
                    break;
                  }
                }
                if (variant) {
                  // Atomic add-back — a doubly-nested subdoc mutation + save()
                  // does not reliably persist (see updateColorVariant).
                  await this.productModel.updateOne(
                    { _id: item.product },
                    {
                      $inc: {
                        'clothing.color_variants.$[cv].variants.$[v].stock':
                          selection.quantity ?? 1,
                      },
                    },
                    {
                      arrayFilters: [
                        { 'cv._id': colorVariant._id },
                        { 'v._id': variant._id },
                      ],
                      session,
                    },
                  );
                  this.logger.log(
                    `[RestoreInventory] Color variant ${selection.variant_id} stock +${selection.quantity ?? 1}`,
                  );
                }
              }
            }
          }

          // Restore applied fabric (from "Use Fabric" feature)
          if (item.applied_fabric && item.applied_fabric_yards) {
            const fabricProduct = await this.productModel
              .findById(item.applied_fabric)
              .session(session);
            if (fabricProduct?.fabric) {
              fabricProduct.fabric.yard_length += item.applied_fabric_yards;
              await fabricProduct.save({ session });
              this.logger.log(
                `[RestoreInventory] Applied fabric ${item.applied_fabric} restored +${item.applied_fabric_yards} yards`,
              );
            }
          }
        }

        // Only a FULL restore clears the order-level flag (so a re-process can
        // deduct again and a second full restore is a no-op). A per-vendor
        // restore leaves other vendors' deductions — and the flag — intact; the
        // reject flow's own guards (shipment.rejected / the atomic refund claim)
        // stop the same vendor being restored twice.
        if (!businessId) {
          (order as any).inventory_deducted = false;
          await order.save({ session });
        }
      });
      this.logger.log(`[RestoreInventory] Inventory restored for order ${orderId}`);
    } catch (err: any) {
      this.logger.error(
        `[RestoreInventory] Failed for order ${orderId}: ${err.stack || err.message}`,
      );
      throw err;
    } finally {
      await session.endSession();
    }
  }


  async updateFabric(item: OrderItem, session, quantityMultiplier = 1) {
    const fabricSelections = item.fabric_selections || [];

    for (const selection of fabricSelections) {
      // Calculate total yardage needed
      const totalYards =
        (selection.yardage ?? 0) *
        (selection.quantity ?? 1) *
        quantityMultiplier;

      // Fetch fabric (standalone or embedded)
      let fabric: any = await this.fabricModel
        .findById(selection.fabric_id)
        .session(session);
      let isEmbedded = false;

      if (!fabric) {
        const product = await this.productModel
          .findById(item.product)
          .session(session);
        if (!product) throw new BadRequestException('Product not found');

        // Clothing-embedded fabric…
        fabric = product.clothing?.fabrics?.find(
          (f) => String(f._id) === String(selection.fabric_id),
        ) as FabricDocument | undefined;

        // …or a standalone fabric-KIND product, whose fabric lives on
        // product.fabric (normalizeSelections stores product.fabric._id as the
        // fabric_id). Without this branch, buying a fabric product threw
        // "Fabric … not found in product or standalone" at inventory time.
        if (
          !fabric &&
          product.fabric &&
          String((product.fabric as any)._id) === String(selection.fabric_id)
        ) {
          fabric = product.fabric as any;
        }

        if (!fabric) {
          throw new BadRequestException(
            `Fabric ${selection.fabric_id} not found in product or standalone`,
          );
        }
        isEmbedded = true;
      }

      // Check if enough yardage
      if (fabric.yard_length < totalYards) {
        throw new BadRequestException(
          `Not enough fabric (${fabric.name}) available`,
        );
      }

      // Update yardage using the separate function
      const newYardLength = fabric.yard_length - totalYards;
      await this.updateFabricStock(
        item.product,
        fabric._id.toString(),
        newYardLength,
        session,
      );
    }
  }

  async updateFabricStock(
    productId: Types.ObjectId,
    fabricId: Types.ObjectId,
    newYardLength: number,
    session?: any,
  ) {
    // 1) Standalone fabric document.
    const standalone = await this.fabricModel
      .findById(fabricId)
      .session(session);
    if (standalone) {
      standalone.yard_length = newYardLength;
      await standalone.save({ session });
      this.logger.log(`Fabric ${fabricId} updated to ${newYardLength} yards`);
      return { fabricId, newYardLength };
    }

    const product = await this.productModel
      .findById(productId)
      .session(session);
    if (!product) throw new BadRequestException('Product not found');

    // 2) Clothing-embedded fabric (clothing.fabrics[]).
    const embedded = product.clothing?.fabrics?.find(
      (f) => String(f._id) === String(fabricId),
    );
    if (embedded) {
      await this.productModel
        .updateOne(
          { _id: productId, 'clothing.fabrics._id': fabricId },
          { $set: { 'clothing.fabrics.$.yard_length': newYardLength } },
        )
        .session(session);
      this.logger.log(`Fabric ${fabricId} updated to ${newYardLength} yards`);
      return { fabricId, newYardLength };
    }

    // 3) Standalone fabric-KIND product: stock lives on product.fabric.
    if (product.fabric && String((product.fabric as any)._id) === String(fabricId)) {
      await this.productModel
        .updateOne(
          { _id: productId },
          { $set: { 'fabric.yard_length': newYardLength } },
        )
        .session(session);
      this.logger.log(`Fabric ${fabricId} updated to ${newYardLength} yards`);
      return { fabricId, newYardLength };
    }

    throw new BadRequestException(
      `Fabric ${fabricId} not found in product or standalone`,
    );
  }

  async updateAccessory(
    item: OrderItem,
    session?: any,
    quantityMultiplier = 1,
  ) {
    const accessorySelections = item.accessory_selections || [];

    for (const selection of accessorySelections) {
      // Accessories chosen without a specific variant have no per-variant stock
      // to track (they are priced at their base price), so there is nothing to
      // decrement — skip them instead of crashing on a missing variant/array.
      if (!selection.variant_id) continue;

      let accessoryVariant: any;
      if (this.accessoryModel) {
        const accessory = await this.accessoryModel
          .findById(selection.accessory_id)
          .session(session);
        if (accessory) {
          accessoryVariant = accessory.variants?.find(
            (v: any) => String(v._id) === String(selection.variant_id),
          );
        }
      }
      if (!accessoryVariant) {
        const product = await this.productModel
          .findById(item.product)
          .session(session);
        if (!product) throw new BadRequestException('Product not found');

        const embeddedAccessory = product.clothing?.accessories?.find(
          (a) => String(a._id) === String(selection.accessory_id),
        );
        if (embeddedAccessory) {
          accessoryVariant = embeddedAccessory.variants?.find(
            (v) => String(v._id) === String(selection.variant_id),
          );
        }

        // Standalone accessory-KIND product: the accessory and its variant
        // stock live on product.accessory — not in a standalone Accessory doc
        // or clothing.accessories. Without this branch, buying an accessory
        // product with a variant threw "variant not found" at inventory time.
        if (
          !accessoryVariant &&
          product.accessory &&
          String((product.accessory as any)._id) === String(selection.accessory_id)
        ) {
          accessoryVariant = (product.accessory as any).variants?.find(
            (v: any) => String(v._id) === String(selection.variant_id),
          );
        }
      }

      if (!accessoryVariant) {
        throw new BadRequestException(
          `Accessory variant ${selection.variant_id} not found in standalone or embedded accessory`,
        );
      }

      // 3️⃣ Calculate total quantity needed
      const totalQuantity = (selection.quantity ?? 1) * quantityMultiplier;
      if ((accessoryVariant.stock ?? 0) < totalQuantity) {
        throw new BadRequestException(
          `Not enough stock for accessory variant (${accessoryVariant._id})`,
        );
      }

      // 4️⃣ Decrement stock
      accessoryVariant.stock -= totalQuantity;

      // 5️⃣ Save changes
      await this.updateAccessoryVariantStock(
        {
          product_id: item.product,
          accessory_id: selection.accessory_id,
          variant_id: selection.variant_id,
          new_stock: accessoryVariant.stock,
        },

        session,
      );
    }
  }

  async updateColorVariant(
    item: OrderItem,
    session?: any,
    quantityMultiplier = 1,
  ) {
    const selections = item.color_variant_selections || [];
    if (selections.length === 0) return;

    const product = await this.productModel
      .findById(item.product)
      .session(session);

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    const colorVariants = product.clothing?.color_variants || [];

    for (const selection of selections) {
      // The stored `variant_id` is the INNER size-variant _id. Find the colour
      // variant that CONTAINS it, then the size variant itself — the two levels
      // have different ids, so we must not match both with the same id.
      let variant: any;
      let colorVariant: any;
      let colorName = '';
      for (const cv of colorVariants) {
        const match = cv.variants.find(
          (v) => String(v._id) === String(selection.variant_id),
        );
        if (match) {
          variant = match;
          colorVariant = cv;
          colorName = cv.name;
          break;
        }
      }

      if (!variant) {
        throw new BadRequestException(
          `Variant ${selection.variant_id} not found`,
        );
      }

      const totalQuantity = (selection.quantity ?? 1) * quantityMultiplier;

      if ((variant.stock ?? 0) < totalQuantity) {
        throw new BadRequestException(
          `Not enough stock for ${colorName} (${variant.size})`,
        );
      }

      // Atomic, guaranteed-persisted decrement of the doubly-nested size-variant
      // stock. Mutating the subdocument in memory + product.save() does NOT
      // reliably mark a nested-array-within-array path dirty in Mongoose, so the
      // decrement could silently fail to persist — which is why clothing stock
      // appeared unchanged after an order. (Matches the atomic pattern
      // restoreInventory already uses for accessories/fabric.)
      const res = await this.productModel.updateOne(
        { _id: item.product },
        {
          $inc: {
            'clothing.color_variants.$[cv].variants.$[v].stock': -totalQuantity,
          },
        },
        {
          arrayFilters: [{ 'cv._id': colorVariant._id }, { 'v._id': variant._id }],
          session,
        },
      );
      if (res.modifiedCount === 0) {
        throw new BadRequestException(
          `Failed to deduct stock for variant ${selection.variant_id}`,
        );
      }
    }
  }

  async updateAccessoryVariantStock(
    dto: UpdateAccessoryVariantStockDto,
    session: any,
  ) {
    const { product_id, accessory_id, variant_id, new_stock } = dto;
    this.logger.log(
      `Updating accessory stock → product=${product_id}, accessory=${accessory_id}, variant=${variant_id}, newStock=${new_stock}`,
    );

    // 1️⃣ Try standalone accessory first
    let accessory: any = null;

    if (this.accessoryModel) {
      accessory = await this.accessoryModel
        .findOne({ _id: accessory_id, 'variants._id': variant_id })
        .session(session);
    }

    if (accessory) {
      this.logger.log(`Standalone accessory found. Updating variant stock...`);

      await this.accessoryModel.updateOne(
        {
          _id: accessory_id,
          'variants._id': variant_id,
        },
        {
          $set: { 'variants.$.stock': new_stock },
        },
        { session },
      );

      this.logger.log(`Standalone accessory variant updated successfully`);

      return { type: 'standalone', new_stock };
    }

    // 2️⃣ Not standalone → Check embedded inside product.clothing.accessories
    this.logger.log(`Checking embedded accessory inside product...`);

    const embeddedAccessory = await this.productModel.findOne(
      {
        _id: product_id,
        'clothing.accessories._id': accessory_id,
        'clothing.accessories.variants._id': variant_id,
      },
      null,
      { session },
    );

    if (embeddedAccessory) {
      this.logger.log(`Embedded accessory found. Updating variant stock...`);

      await this.productModel.updateOne(
        {
          _id: product_id,
          'clothing.accessories._id': accessory_id,
        },
        {
          $set: {
            'clothing.accessories.$.variants.$[variant].stock': new_stock,
          },
        },
        {
          session,
          arrayFilters: [{ 'variant._id': variant_id }],
        },
      );

      this.logger.log(`Embedded accessory variant updated successfully`);
      return { type: 'embedded', new_stock };
    }

    // 3️⃣ Standalone accessory-KIND product: stock lives on product.accessory.
    const accessoryKind = await this.productModel.findOne(
      {
        _id: product_id,
        'accessory._id': accessory_id,
        'accessory.variants._id': variant_id,
      },
      null,
      { session },
    );

    if (!accessoryKind) {
      throw new BadRequestException(
        `Accessory variant ${variant_id} not found in standalone, embedded, or accessory product`,
      );
    }

    this.logger.log(`Accessory-kind product found. Updating variant stock...`);

    await this.productModel.updateOne(
      { _id: product_id },
      { $set: { 'accessory.variants.$[variant].stock': new_stock } },
      {
        session,
        arrayFilters: [{ 'variant._id': variant_id }],
      },
    );

    this.logger.log(`Accessory-kind product variant updated successfully`);
    return { type: 'accessory_kind', new_stock };
  }

  /* ------------------------------------------------------------------ */
  /* Admin catalogue                                                     */
  /*                                                                     */
  /* `findAll` above is the customer-facing catalogue: it hard-codes      */
  /* status=ACTIVE and gates on approved vendors, so a moderator looking  */
  /* through it would only ever see the products that need no attention. */
  /* Everything below reads the collection unfiltered instead.           */
  /* ------------------------------------------------------------------ */

  /**
   * Window the catalogue stat cards compare, in days. Matches the vendors
   * page's summary so the two consoles report movement over the same period.
   *
   * CAVEAT on the archived movement: a Product carries no record of *when* its
   * status changed, so it compares documents currently archived whose
   * `updatedAt` falls in the window — any other edit to an archived product
   * counts it again. `total_products` is by `createdAt` and has no such caveat.
   */
  private static readonly CATALOGUE_TREND_DAYS = 30;

  /** Product name across all three kinds, falling back to the SEO title. */
  private static productName(p: any): string {
    return (
      p?.clothing?.name ??
      p?.accessory?.name ??
      p?.fabric?.name ??
      p?.seo?.title ??
      'this product'
    );
  }

  /** Mongo filter for the admin catalogue — the shared half of list + stats. */
  private buildAdminFilter(dto: AdminFindProductsDto): any {
    const and: any[] = [];
    const filter: any = {};

    if (dto.kind) filter.kind = dto.kind;
    if (dto.status) filter.status = dto.status;
    if (dto.type) filter['clothing.type'] = dto.type;

    if (dto.moderation_status) {
      and.push(
        dto.moderation_status === ProductModerationStatus.PENDING
          ? {
              // Legacy products predate the moderation field: absent reads as pending.
              $or: [
                { 'moderation.status': ProductModerationStatus.PENDING },
                { 'moderation.status': { $exists: false } },
                { moderation: null },
              ],
            }
          : { 'moderation.status': dto.moderation_status },
      );
    }

    if (dto.business_id) {
      and.push({
        $or: [
          { business: new Types.ObjectId(dto.business_id) },
          { business: dto.business_id },
        ],
      });
    }

    if (dto.product_type) {
      and.push({
        $or: [
          { 'clothing.taxonomy.product_type': dto.product_type },
          { 'accessory.taxonomy.product_type': dto.product_type },
          { 'fabric.taxonomy.product_type': dto.product_type },
        ],
      });
    }

    if (dto.category) {
      and.push({
        $or: [
          { 'clothing.taxonomy.categories': dto.category },
          { 'accessory.taxonomy.categories': dto.category },
          { 'fabric.taxonomy.categories': dto.category },
        ],
      });
    }

    if (dto.audience) {
      const synonyms: Record<string, string> = {
        male: 'men',
        female: 'women',
        men: 'male',
        women: 'female',
      };
      const values = [
        dto.audience,
        ...(synonyms[dto.audience] ? [synonyms[dto.audience]] : []),
      ];
      and.push({
        $or: [
          { 'clothing.taxonomy.audience': { $in: values } },
          { 'accessory.taxonomy.audience': { $in: values } },
          { 'fabric.taxonomy.audience': { $in: values } },
        ],
      });
    }

    if (dto.tag) {
      and.push({
        $or: [
          { 'tags.slug': dto.tag },
          { 'tags.name': dto.tag },
          { 'metafields.tags.slug': dto.tag },
          { 'metafields.tags.name': dto.tag },
        ],
      });
    }

    if (dto.search) {
      const clause = this.buildSearchClause(dto.search);
      if (clause) and.push(clause);
    }

    if (dto.on_sale) {
      and.push({
        $expr: {
          $and: [
            { $gt: ['$discounted_price', 0] },
            { $lt: ['$discounted_price', '$base_price'] },
          ],
        },
      });
    }

    if (dto.in_stock) {
      and.push({
        $or: [
          { $and: [{ kind: 'clothing' }, { 'clothing.type': 'customize' }] },
          { 'clothing.color_variants.variants.stock': { $gt: 0 } },
          { 'accessory.variants.stock': { $gt: 0 } },
          { 'accessory.in_stock': true },
          {
            $expr: {
              $and: [
                { $gt: [{ $ifNull: ['$fabric.yard_length', 0] }, 0] },
                {
                  $gte: [
                    { $ifNull: ['$fabric.yard_length', 0] },
                    { $ifNull: ['$fabric.min_cut', 0] },
                  ],
                },
              ],
            },
          },
        ],
      });
    }

    if (dto.minPrice !== undefined || dto.maxPrice !== undefined) {
      const effective = {
        $cond: [
          { $gt: ['$discounted_price', 0] },
          '$discounted_price',
          '$base_price',
        ],
      };
      if (dto.minPrice !== undefined) {
        and.push({ $expr: { $gte: [effective, dto.minPrice] } });
      }
      if (dto.maxPrice !== undefined) {
        and.push({ $expr: { $lte: [effective, dto.maxPrice] } });
      }
    }

    if (dto.from || dto.to) {
      const range: any = {};
      if (dto.from) range.$gte = new Date(dto.from);
      if (dto.to) {
        // `to` is a calendar day from a date picker — include the whole day.
        const end = new Date(dto.to);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
      filter.createdAt = range;
    }

    if (and.length) filter.$and = and;
    return filter;
  }

  /** The full catalogue for the admin table — every status, every vendor. */
  async adminFindAll(dto: AdminFindProductsDto) {
    const { page = 1, size = 10, sortBy, order = 'desc' } = dto;
    const filter = this.buildAdminFilter(dto);
    const { take, skip } = await Utils.getPagination(Number(page), Number(size));

    const direction = order === 'asc' ? 1 : -1;
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      date: { createdAt: direction },
      price: { base_price: direction },
      rating: { average_rating: direction },
      // Only one kind's name is ever set per document, so sorting across all
      // three keys orders the mixed list correctly.
      name: {
        'clothing.name': direction,
        'accessory.name': direction,
        'fabric.name': direction,
      },
      stock: { 'fabric.yard_length': direction },
    };
    const sort = sortMap[sortBy ?? 'date'] ?? { createdAt: -1 as const };

    const [rows, count, thresholds] = await Promise.all([
      this.productModel
        .find(filter)
        .populate('business', 'business_name business_logo_url status is_active')
        .sort(sort as any)
        .skip(skip)
        .limit(take)
        .lean()
        .exec(),
      this.productModel.countDocuments(filter),
      this.getStockThresholds(),
    ]);

    const data = rows.map((r) => withAvailability(r, thresholds));
    return Utils.getPagingData({ rows: data, count }, Number(page), Number(size));
  }

  /** One product for the admin, ungated by status or vendor approval. */
  async adminFindOne(productId: string) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new BadRequestException('Invalid product id');
    }
    const [product, thresholds] = await Promise.all([
      this.productModel
        .findById(productId)
        .populate(
          'business',
          'business_name business_logo_url cover_image_url theme_color description status is_active',
        )
        .lean()
        .exec(),
      this.getStockThresholds(),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    return withAvailability(product, thresholds);
  }

  /**
   * Header metrics for the admin catalogue: the status split, plus a real
   * sales-by-category breakdown from delivered order items (the donut had been
   * drawing a hard-coded four-way split).
   */
  async adminStats(dto: AdminFindProductsDto) {
    // Counts ignore the status filter — the cards describe the whole catalogue
    // for this kind, not the slice the table happens to be showing.
    const { status, moderation_status, ...rest } = dto;
    const base = this.buildAdminFilter(rest as AdminFindProductsDto);

    const days = ProductService.CATALOGUE_TREND_DAYS;
    const now = Date.now();
    const current = { $gte: new Date(now - days * 86_400_000) };
    const previous = {
      $gte: new Date(now - 2 * days * 86_400_000),
      $lt: new Date(now - days * 86_400_000),
    };

    const tally = (match: Record<string, unknown>) => [
      { $match: { ...base, ...match } },
      { $count: 'n' },
    ];
    const archived = { status: ProductStatus.ARCHIVED };

    const [byStatus, byModeration, total, scheduled, [movement]] =
      await Promise.all([
        this.productModel.aggregate([
          { $match: base },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.productModel.aggregate([
          { $match: base },
          {
            $group: {
              _id: {
                $ifNull: [
                  '$moderation.status',
                  ProductModerationStatus.PENDING,
                ],
              },
              count: { $sum: 1 },
            },
          },
        ]),
        this.productModel.countDocuments(base),
        this.productModel.countDocuments({
          ...base,
          scheduled_activation_date: { $ne: null },
        }),
        // One round trip for the four trend windows, the way the vendors page's
        // summary does it.
        this.productModel.aggregate<Record<string, { n: number }[]>>([
          {
            $facet: {
              totalCurrent: tally({ createdAt: current }),
              totalPrevious: tally({ createdAt: previous }),
              archivedCurrent: tally({ ...archived, updatedAt: current }),
              archivedPrevious: tally({ ...archived, updatedAt: previous }),
            },
          },
        ]),
      ]);

    const pick = (rows: any[], key: string) =>
      rows.find((r) => r._id === key)?.count ?? 0;
    const read = (key: string): number => movement?.[key]?.[0]?.n ?? 0;

    return {
      total_products: total,
      active_products: pick(byStatus, ProductStatus.ACTIVE),
      draft_products: pick(byStatus, ProductStatus.DRAFT),
      archived_products: pick(byStatus, ProductStatus.ARCHIVED),
      scheduled_products: scheduled,
      pending_products: pick(byModeration, ProductModerationStatus.PENDING),
      approved_products: pick(byModeration, ProductModerationStatus.APPROVED),
      rejected_products: pick(byModeration, ProductModerationStatus.REJECTED),
      changes: {
        period_days: days,
        total_products: percentageChange(
          read('totalCurrent'),
          read('totalPrevious'),
        ),
        archived_products: percentageChange(
          read('archivedCurrent'),
          read('archivedPrevious'),
        ),
      },
      sales_by_category: await this.salesByCategory(dto.kind),
    };
  }

  /**
   * Units sold per taxonomy category, from paid orders. Order items carry no
   * top-level quantity — it lives on the colour-variant selections — so a line
   * with no selections counts as one unit. Falls back to the catalogue's own
   * category spread when nothing has sold yet, so the donut still says
   * something true rather than rendering empty.
   */
  private async salesByCategory(
    kind?: string,
  ): Promise<{ name: string; value: number }[]> {
    const firstCategory = {
      $ifNull: [
        { $arrayElemAt: ['$product.clothing.taxonomy.categories', 0] },
        {
          $ifNull: [
            { $arrayElemAt: ['$product.accessory.taxonomy.categories', 0] },
            { $arrayElemAt: ['$product.fabric.taxonomy.categories', 0] },
          ],
        },
      ],
    };

    const sold = await this.orderModel
      .aggregate([
        { $match: { payment_status: 'paid' } },
        { $unwind: '$items' },
        {
          $match: {
            'items.product': { $ne: null },
            'items.rejected': { $ne: true },
          },
        },
        {
          $project: {
            product_id: '$items.product',
            units: {
              $let: {
                vars: {
                  q: { $sum: '$items.color_variant_selections.quantity' },
                },
                in: { $cond: [{ $gt: ['$$q', 0] }, '$$q', 1] },
              },
            },
          },
        },
        {
          $lookup: {
            from: 'products',
            localField: 'product_id',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: '$product' },
        ...(kind ? [{ $match: { 'product.kind': kind } }] : []),
        { $project: { units: 1, category: firstCategory } },
        { $match: { category: { $ne: null } } },
        { $group: { _id: '$category', value: { $sum: '$units' } } },
        { $sort: { value: -1 } },
        { $limit: 4 },
      ])
      .catch(() => [] as any[]);

    if (sold.length) {
      return sold.map((r: any) => ({ name: r._id, value: r.value }));
    }

    const spread = await this.productModel.aggregate([
      ...(kind ? [{ $match: { kind } }] : []),
      {
        $project: {
          categories: {
            $ifNull: [
              '$clothing.taxonomy.categories',
              {
                $ifNull: [
                  '$accessory.taxonomy.categories',
                  '$fabric.taxonomy.categories',
                ],
              },
            ],
          },
        },
      },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 4 },
    ]);
    return spread.map((r: any) => ({ name: r._id, value: r.value }));
  }

  /**
   * The values actually present in the catalogue, for the table's "Filter By"
   * menu. Read from the data rather than the taxonomy master list so the menu
   * can never offer a filter that returns nothing.
   */
  async adminFilterOptions(kind?: string) {
    const match: any = kind ? { kind } : {};
    const paths = kind
      ? [kind]
      : ['clothing', 'accessory', 'fabric'];

    const distinctAcross = async (leaf: string) => {
      const values = await Promise.all(
        paths.map((p) =>
          this.productModel.distinct(`${p}.taxonomy.${leaf}`, match),
        ),
      );
      return [
        ...new Set(
          values
            .flat()
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      ].sort();
    };

    const [product_types, categories, audiences, tagDocs, vendors] =
      await Promise.all([
        distinctAcross('product_type'),
        distinctAcross('categories'),
        distinctAcross('audience'),
        this.productModel.distinct('tags', match),
        this.productModel.aggregate([
          { $match: match },
          { $group: { _id: '$business', count: { $sum: 1 } } },
          {
            $lookup: {
              from: 'businesses',
              localField: '_id',
              foreignField: '_id',
              as: 'business',
            },
          },
          { $unwind: '$business' },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: '$business.business_name',
              count: 1,
            },
          },
          { $sort: { name: 1 } },
        ]),
      ]);

    const tags = [
      ...new Map(
        (tagDocs as any[])
          .filter((t) => t?.name)
          .map((t) => [t.slug ?? t.name, { name: t.name, slug: t.slug ?? t.name }]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return {
      product_types,
      categories,
      audiences,
      tags,
      vendors,
      statuses: Object.values(ProductStatus),
      moderation_statuses: Object.values(ProductModerationStatus),
    };
  }

  /** Colour identity for variant matching — hex if there is one, else name. */
  private static colourKey(colour: any): string {
    return (colour?.hex ?? colour?.name ?? '').toString().trim().toLowerCase();
  }

  private static sizeKey(size: unknown): string {
    return (size ?? '').toString().trim().toLowerCase();
  }

  /**
   * Carry existing variant `_id`s onto an incoming edit, matched on
   * colour + size.
   *
   * An edit form re-sends the whole `color_variants` array, so writing it
   * straight through hands Mongoose a fresh set of subdocuments and it mints
   * new `_id`s for every one. Those ids are not cosmetic: an order line stores
   * `color_variant_selections[].variant_id` against them, and stock deduction
   * matches with `arrayFilters: [{ 'variant._id': variant_id }]`. Regenerating
   * them would leave every open order pointing at variants that no longer
   * exist — the filter matches nothing, no stock moves, and nothing errors.
   *
   * A colour or size the edit removed simply doesn't come back, and a newly
   * added one gets a fresh id, which is correct in both cases.
   */
  private static mergeColorVariants(existing: any[], incoming: any[]): any[] {
    const colours = new Map<string, any>();
    const variants = new Map<string, any>();

    for (const colour of existing ?? []) {
      const ck = ProductService.colourKey(colour);
      if (ck) colours.set(ck, colour);
      for (const variant of colour?.variants ?? []) {
        variants.set(`${ck}::${ProductService.sizeKey(variant?.size)}`, variant);
      }
    }

    return (incoming ?? []).map((colour) => {
      const ck = ProductService.colourKey(colour);
      const previousColour = colours.get(ck);
      return {
        ...colour,
        ...(previousColour?._id ? { _id: previousColour._id } : {}),
        variants: (colour?.variants ?? []).map((variant: any) => {
          const previous = variants.get(
            `${ck}::${ProductService.sizeKey(variant?.size)}`,
          );
          return previous?._id ? { ...variant, _id: previous._id } : variant;
        }),
      };
    });
  }

  /** The same id-preserving merge for a flat variant list (accessories). */
  private static mergeFlatVariants(existing: any[], incoming: any[]): any[] {
    const key = (variant: any) =>
      `${ProductService.colourKey(variant?.color)}::${ProductService.sizeKey(variant?.size)}`;

    const previous = new Map<string, any>(
      (existing ?? []).map((variant) => [key(variant), variant]),
    );

    return (incoming ?? []).map((variant) => {
      const match = previous.get(key(variant));
      return match?._id ? { ...variant, _id: match._id } : variant;
    });
  }

  /**
   * Apply an admin edit. Only the keys present are written, so the form can
   * send a partial without wiping fields it doesn't render.
   *
   * Editing a rejected listing sends it back for review rather than silently
   * leaving the rejection in place — the admin has just changed the thing that
   * was wrong with it.
   */
  async adminUpdate(productId: string, dto: AdminUpdateProductDto) {
    const product = await this.assertProduct(productId);

    if (dto.seo) {
      product.seo = { ...(product.seo ?? {}), ...dto.seo };
    }
    if (dto.metafields) {
      product.metafields = { ...(product.metafields ?? {}), ...dto.metafields };
    }
    if (dto.base_price !== undefined) {
      product.base_price = dto.base_price;
    }
    if (dto.status && dto.status !== product.status) {
      // Only a genuine status change cancels a pending activation. Clearing it
      // on any edit that merely echoes the current status back would silently
      // unschedule a product because someone fixed a typo in its description.
      product.status = dto.status;
      product.scheduled_activation_date = undefined;
    }

    // Only the sub-document matching this product's own kind is applied — an
    // accessory payload must not graft a `clothing` block onto a fabric.
    const kind = product.kind as 'clothing' | 'accessory' | 'fabric';
    const detail = dto[kind];
    if (detail && Object.keys(detail).length) {
      const current = (product as any)[kind];
      const plain =
        current && typeof current.toObject === 'function'
          ? current.toObject()
          : (current ?? {});

      const merged: Record<string, any> = { ...plain, ...detail };

      // `status` is top-level on the product; the sub-schema has no such path,
      // so a copy inside the kind document is a stray key at best.
      delete merged.status;

      if (detail.color_variants) {
        merged.color_variants = ProductService.mergeColorVariants(
          plain.color_variants,
          detail.color_variants,
        );
      }
      if (detail.variants) {
        merged.variants = ProductService.mergeFlatVariants(
          plain.variants,
          detail.variants,
        );
      }

      (product as any)[kind] = merged;
      product.markModified(kind);
    }

    if (product.moderation?.status === ProductModerationStatus.REJECTED) {
      product.moderation = {
        status: ProductModerationStatus.PENDING,
        reason: null,
        moderated_at: new Date(),
        moderated_by: null,
      };
    }

    await product.save();
    return {
      message: 'Product updated',
      data: product.toJSON(),
    };
  }

  /**
   * Admin publish switch (Activate / Deactivate). Unlike the vendor route this
   * skips the business-ownership check — moderating any vendor's listing is the
   * whole point — and notifies the vendor that the platform moved it.
   */
  async adminUpdateStatus(
    productId: string,
    status: ProductStatus,
    reason?: string,
  ) {
    const product = await this.assertProduct(productId);

    product.status = status;
    // A manual switch overrides any pending schedule, same as the vendor path.
    product.scheduled_activation_date = undefined;
    if (reason) {
      product.moderation = {
        ...(product.moderation ?? { status: ProductModerationStatus.PENDING }),
        reason,
        moderated_at: new Date(),
      } as any;
    }
    await product.save();

    await this.notifyVendorOfProduct(
      product,
      NotificationType.PRODUCT_STATUS_CHANGED,
      status === ProductStatus.ACTIVE ? 'Product activated' : 'Product updated',
      `${ProductService.productName(product)} was set to "${status}" by the Qlozet team.${
        reason ? ` Reason: ${reason}` : ''
      }`,
    );

    return {
      message: `Product status updated to ${status}`,
      data: product.toJSON(),
    };
  }

  /** Admin-side scheduling — the vendor route is business-scoped. */
  async adminScheduleActivation(productId: string, activationDate: Date) {
    const product = await this.assertProduct(productId);

    if (Number.isNaN(activationDate.getTime())) {
      throw new BadRequestException('Invalid activation date');
    }
    if (activationDate <= new Date()) {
      throw new BadRequestException('Activation date must be in the future');
    }

    product.scheduled_activation_date = activationDate;
    // Keep the product out of the catalogue until the cron flips it live.
    if (product.status === ProductStatus.ACTIVE) {
      product.status = ProductStatus.SCHEDULED;
    }
    await product.save();

    await this.notifyVendorOfProduct(
      product,
      NotificationType.PRODUCT_STATUS_CHANGED,
      'Product activation scheduled',
      `${ProductService.productName(product)} will go live on ${activationDate.toUTCString()}.`,
    );

    return {
      message: 'Product scheduled for automatic activation',
      data: {
        _id: product._id,
        status: product.status,
        scheduled_activation_date: product.scheduled_activation_date,
      },
    };
  }

  /**
   * Approve or reject a listing. Rejection does not delete anything — it flags
   * the product and takes it out of the customer catalogue (see the moderation
   * gate in `findAll`), leaving the vendor able to fix and resubmit.
   */
  async adminModerate(
    productId: string,
    decision: ProductModerationStatus,
    adminUserId?: string,
    reason?: string,
  ) {
    if (decision === ProductModerationStatus.REJECTED && !reason?.trim()) {
      throw new BadRequestException('A reason is required to reject a product');
    }

    const product = await this.assertProduct(productId);

    product.moderation = {
      status: decision,
      reason: reason ?? null,
      moderated_at: new Date(),
      moderated_by: adminUserId ? new Types.ObjectId(adminUserId) : null,
    };

    // A rejected product must not stay in the storefront.
    if (decision === ProductModerationStatus.REJECTED) {
      product.status = ProductStatus.DRAFT;
      product.scheduled_activation_date = undefined;
    }
    await product.save();

    const approved = decision === ProductModerationStatus.APPROVED;
    await this.notifyVendorOfProduct(
      product,
      approved
        ? NotificationType.PRODUCT_APPROVED
        : NotificationType.PRODUCT_REJECTED,
      approved ? 'Product approved ✅' : 'Product rejected',
      approved
        ? `${ProductService.productName(product)} has been approved and can go live.`
        : `${ProductService.productName(product)} was rejected. Reason: ${reason}`,
    );

    return {
      message: approved ? 'Product approved' : 'Product rejected',
      data: product.toJSON(),
    };
  }

  private async assertProduct(productId: string): Promise<ProductDocument> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new BadRequestException('Invalid product id');
    }
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /** Best-effort vendor notification; never fails the moderation action. */
  private async notifyVendorOfProduct(
    product: ProductDocument,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    try {
      const business = await this.businessModel
        .findById(product.business)
        .select('created_by')
        .lean();
      const recipient = (business as any)?.created_by?.id?.toString();
      if (!recipient) return;

      await this.notificationsService.create({
        recipient,
        recipient_business: product.business?.toString?.(),
        category: NotificationCategory.PRODUCT,
        type,
        title,
        body,
        metadata: { product_id: product._id },
        action_url: '/products',
      });
    } catch (err: any) {
      this.logger.warn(`Product notification failed: ${err.message}`);
    }
  }
}
