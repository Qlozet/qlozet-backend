import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Collection, CollectionDocument, CollectionScope } from './schemas/collection.schema';
import { CreateCollectionDto, CreatePlatformCollectionDto, UpdateCollectionDto } from './dto/collection.dto';
import { Product, ProductDocument } from './schemas';
import { Utils } from '../../common/utils/pagination';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    @InjectModel(Collection.name)
    private readonly collectionModel: Model<CollectionDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  /**
   * Get all collections
   */
  async findAll(): Promise<CollectionDocument[]> {
    return this.collectionModel.find().exec();
  }

  /**
   * Get all collections by vendor
   */
  async findByVendor(vendorId: string): Promise<CollectionDocument[]> {
    return this.collectionModel.find({ vendor: vendorId }).exec();
  }

  /**
   * Create a new collection and auto-assign matching products
   */
  async create(
    createCollectionDto: CreateCollectionDto,
    business: string,
  ): Promise<CollectionDocument> {
    this.logger.log(`Creating new collection: ${createCollectionDto.title}`);

    const collection = new this.collectionModel({
      ...createCollectionDto,
      business: new Types.ObjectId(business),
      condition_match: createCollectionDto.condition_match || 'all',
      manual_includes: (createCollectionDto.manual_includes || []).map(
        (id) => new Types.ObjectId(id),
      ),
      manual_excludes: (createCollectionDto.manual_excludes || []).map(
        (id) => new Types.ObjectId(id),
      ),
    });

    const savedCollection = await collection.save();
    this.logger.log(`Collection saved: ${savedCollection._id}`);

    // Run product assignment in background
    this.applyCollectionToMatchingProducts(savedCollection.id)
      .then((count) => {
        this.logger.log(
          `Applied collection ${savedCollection._id} to ${count} products`,
        );
      })
      .catch((err) => {
        this.logger.error('Error applying collection to products:', err);
      });

    return savedCollection.toObject();
  }

  /**
   * Apply collection rules to products and attach/remove collection IDs.
   * - Vendor-scoped collections only scan that vendor's products.
   * - Platform-scoped collections scan all products.
   * - Respects manual_includes and manual_excludes overrides.
   * - Removes the collection from products that no longer match.
   */
  async applyCollectionToMatchingProducts(
    collectionId: string,
  ): Promise<number> {
    this.logger.log(`[applyCollection] For collection ID: ${collectionId}`);

    const collection = await this.collectionModel.findById(collectionId).exec();
    if (!collection) throw new NotFoundException('Collection not found');
    if (!collection.is_active) {
      this.logger.log(`Collection is inactive, skipping: ${collectionId}`);
      return 0;
    }

    // Scope product query: vendor collections only check vendor's own products
    const productFilter: FilterQuery<ProductDocument> = {};
    if (
      collection.scope === CollectionScope.VENDOR &&
      collection.business
    ) {
      productFilter.business = collection.business;
    }

    const products = await this.productModel.find(productFilter).exec();
    this.logger.log(`Checking ${products.length} products for collection match`);

    const collectionObjectId = new Types.ObjectId(collectionId);
    const includeSet = new Set(
      (collection.manual_includes || []).map((id) => id.toString()),
    );
    const excludeSet = new Set(
      (collection.manual_excludes || []).map((id) => id.toString()),
    );

    let updatedCount = 0;

    for (const product of products) {
      const productIdStr = (product._id as Types.ObjectId).toString();

      // Determine if product should belong to this collection
      let shouldBelong: boolean;

      if (excludeSet.has(productIdStr)) {
        // Manual exclude always wins
        shouldBelong = false;
      } else if (includeSet.has(productIdStr)) {
        // Manual include always wins
        shouldBelong = true;
      } else {
        // Fall back to automated rule evaluation
        shouldBelong = this.evaluateProductAgainstConditions(product, collection);
      }

      if (!product.collections) product.collections = [];
      const alreadyIn = product.collections.some((id) =>
        id.equals(collectionObjectId),
      );

      if (shouldBelong && !alreadyIn) {
        // Add to collection
        product.collections.push(collectionObjectId);
        await product.save();
        updatedCount++;
      } else if (!shouldBelong && alreadyIn) {
        // Remove from collection
        product.collections = product.collections.filter(
          (id) => !id.equals(collectionObjectId),
        );
        await product.save();
        updatedCount++;
      }
    }

    this.logger.log(
      `Finished applying collection ${collectionId}. ${updatedCount} products updated.`,
    );
    return updatedCount;
  }

  /**
   * Sync a single product against all relevant collections.
   * Called when a product is created or updated.
   */
  async syncProductWithCollections(productId: string): Promise<void> {
    const product = await this.productModel.findById(productId).exec();
    if (!product) return;

    const businessId = product.business?.toString();

    // Find all active collections this product could belong to:
    // 1. Vendor collections for this product's business
    // 2. All platform-wide collections
    const collections = await this.collectionModel
      .find({
        is_active: true,
        $or: [
          { scope: CollectionScope.PLATFORM },
          ...(businessId
            ? [
                {
                  scope: CollectionScope.VENDOR,
                  business: new Types.ObjectId(businessId),
                },
              ]
            : []),
        ],
      })
      .exec();

    if (!product.collections) product.collections = [];

    let changed = false;

    for (const collection of collections) {
      const collectionObjectId = new Types.ObjectId(String(collection._id));
      const productIdStr = (product._id as Types.ObjectId).toString();

      const includeSet = new Set(
        (collection.manual_includes || []).map((id) => id.toString()),
      );
      const excludeSet = new Set(
        (collection.manual_excludes || []).map((id) => id.toString()),
      );

      let shouldBelong: boolean;

      if (excludeSet.has(productIdStr)) {
        shouldBelong = false;
      } else if (includeSet.has(productIdStr)) {
        shouldBelong = true;
      } else {
        shouldBelong = this.evaluateProductAgainstConditions(product, collection);
      }

      const alreadyIn = product.collections.some((id) =>
        id.equals(collectionObjectId),
      );

      if (shouldBelong && !alreadyIn) {
        product.collections.push(collectionObjectId);
        changed = true;
      } else if (!shouldBelong && alreadyIn) {
        product.collections = product.collections.filter(
          (id) => !id.equals(collectionObjectId),
        );
        changed = true;
      }
    }

    if (changed) {
      await product.save();
      this.logger.log(`Synced product ${productId} with ${collections.length} collections`);
    }
  }

  /**
   * Event listener: auto-sync product collections when a product is created or updated.
   */
  @OnEvent('product.upserted', { async: true })
  async handleProductUpserted(product: any): Promise<void> {
    const productId = product._id?.toString?.() || product._id;
    if (!productId) return;

    this.logger.log(`[Event] product.upserted → syncing collections for ${productId}`);
    try {
      await this.syncProductWithCollections(productId);
    } catch (err) {
      this.logger.error(`Failed to sync collections for product ${productId}:`, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  // MANUAL INCLUDE / EXCLUDE
  // ─────────────────────────────────────────────────────────

  /**
   * Manually include a product in a collection (override rules)
   */
  async includeProduct(collectionId: string, productId: string, businessId?: string) {
    const collection = await this.collectionModel.findById(collectionId);
    if (!collection) throw new NotFoundException('Collection not found');

    // Ownership check for vendor collections
    if (
      collection.scope === CollectionScope.VENDOR &&
      businessId &&
      collection.business?.toString() !== businessId
    ) {
      throw new ForbiddenException('You can only modify your own collections');
    }

    const productOid = new Types.ObjectId(productId);

    // Remove from excludes if present
    collection.manual_excludes = (collection.manual_excludes || []).filter(
      (id) => !id.equals(productOid),
    );

    // Add to includes if not already present
    const alreadyIncluded = (collection.manual_includes || []).some(
      (id) => id.equals(productOid),
    );
    if (!alreadyIncluded) {
      collection.manual_includes = [...(collection.manual_includes || []), productOid];
    }

    await collection.save();

    // Add collection to the product
    await this.productModel.updateOne(
      { _id: productOid },
      { $addToSet: { collections: new Types.ObjectId(collectionId) } },
    );

    return { message: 'Product included in collection', collectionId, productId };
  }

  /**
   * Manually exclude a product from a collection (override rules)
   */
  async excludeProduct(collectionId: string, productId: string, businessId?: string) {
    const collection = await this.collectionModel.findById(collectionId);
    if (!collection) throw new NotFoundException('Collection not found');

    // Ownership check for vendor collections
    if (
      collection.scope === CollectionScope.VENDOR &&
      businessId &&
      collection.business?.toString() !== businessId
    ) {
      throw new ForbiddenException('You can only modify your own collections');
    }

    const productOid = new Types.ObjectId(productId);

    // Remove from includes if present
    collection.manual_includes = (collection.manual_includes || []).filter(
      (id) => !id.equals(productOid),
    );

    // Add to excludes if not already present
    const alreadyExcluded = (collection.manual_excludes || []).some(
      (id) => id.equals(productOid),
    );
    if (!alreadyExcluded) {
      collection.manual_excludes = [...(collection.manual_excludes || []), productOid];
    }

    await collection.save();

    // Remove collection from the product
    await this.productModel.updateOne(
      { _id: productOid },
      { $pull: { collections: new Types.ObjectId(collectionId) } },
    );

    return { message: 'Product excluded from collection', collectionId, productId };
  }

  /**
   * Get all products under a specific collection
   */
  async getProductsByCollection(
    collectionId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    total_items: number;
    data: ProductDocument[];
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const { take, skip } = await Utils.getPagination(page, limit);

    const [products, totalCount] = await Promise.all([
      this.productModel
        .find({ collections: new Types.ObjectId(collectionId) })
        .skip(skip)
        .limit(take)
        .populate('collections')
        .exec(),
      this.productModel.countDocuments({
        collections: new Types.ObjectId(collectionId),
      }),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: products },
      page,
      limit,
    );
  }

  /**
   * Get all collections and their products by vendor
   */
  async getCollectionsWithProductsByVendor(
    business: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      is_active?: boolean;
      condition_match?: 'all' | 'any';
    },
  ): Promise<{
    total_items: number;
    data: any[];
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const { page = 1, limit = 10, search, is_active, condition_match } = query;
    const { take, skip } = await Utils.getPagination(page, limit);

    const collectionFilter: FilterQuery<CollectionDocument> = {
      business: new Types.ObjectId(business),
    };

    if (typeof is_active === 'boolean') collectionFilter.is_active = is_active;
    if (condition_match) collectionFilter.condition_match = condition_match;
    if (search?.trim()) {
      collectionFilter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const [collections, totalCount] = await Promise.all([
      this.collectionModel
        .find(collectionFilter)
        .skip(skip)
        .limit(take)
        .sort({ createdAt: -1 })
        .exec(),
      this.collectionModel.countDocuments(collectionFilter),
    ]);
    const allProducts = await this.productModel
      .find({ business, collections: { $in: collections.map((c) => c._id) } })
      .populate('collections')
      .exec();

    const rows = collections.map((collection) => ({
      ...collection.toObject(), // spread collection fields
      products: allProducts.filter((p) =>
        p.collections.some((c) => String(c._id) === String(collection._id)),
      ),
    }));

    return Utils.getPagingData({ count: totalCount, rows }, page, limit);
  }

  async getCollectionById(id: string) {
    return this.collectionModel.findById(id).lean();
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE & DELETE (Vendor)
  // ─────────────────────────────────────────────────────────

  async update(
    collectionId: string,
    dto: UpdateCollectionDto,
    businessId: string,
  ) {
    const collection = await this.collectionModel.findById(collectionId);
    if (!collection) throw new NotFoundException('Collection not found');

    // Vendor can only edit their own collections
    if (
      collection.scope === CollectionScope.VENDOR &&
      collection.business?.toString() !== businessId
    ) {
      throw new ForbiddenException('You can only edit your own collections');
    }

    // Convert string IDs to ObjectIds for manual overrides
    if (dto.manual_includes) {
      (collection as any).manual_includes = dto.manual_includes.map(
        (id) => new Types.ObjectId(id),
      );
    }
    if (dto.manual_excludes) {
      (collection as any).manual_excludes = dto.manual_excludes.map(
        (id) => new Types.ObjectId(id),
      );
    }

    // Apply remaining DTO fields (excluding manual overrides already handled)
    const { manual_includes, manual_excludes, ...rest } = dto;
    Object.assign(collection, rest);

    const saved = await collection.save();

    // Re-apply conditions if rules, overrides, or active status changed
    if (dto.conditions || dto.manual_includes || dto.manual_excludes || dto.is_active !== undefined) {
      this.applyCollectionToMatchingProducts(saved.id).catch(() => {});
    }

    return saved;
  }

  async delete(collectionId: string, businessId: string) {
    const collection = await this.collectionModel.findById(collectionId);
    if (!collection) throw new NotFoundException('Collection not found');

    if (
      collection.scope === CollectionScope.VENDOR &&
      collection.business?.toString() !== businessId
    ) {
      throw new ForbiddenException('You can only delete your own collections');
    }

    // Remove collection reference from all products
    await this.productModel.updateMany(
      { collections: collection._id },
      { $pull: { collections: collection._id } },
    );

    await this.collectionModel.findByIdAndDelete(collectionId);
    return { deleted: true, id: collectionId };
  }

  // ─────────────────────────────────────────────────────────
  // PLATFORM COLLECTIONS (Admin)
  // ─────────────────────────────────────────────────────────

  async createPlatformCollection(dto: CreatePlatformCollectionDto) {
    const slug = dto.slug || this.generateSlug(dto.title);

    const collection = new this.collectionModel({
      ...dto,
      slug,
      scope: CollectionScope.PLATFORM,
      business: null,
      manual_includes: (dto.manual_includes || []).map(
        (id) => new Types.ObjectId(id),
      ),
      manual_excludes: (dto.manual_excludes || []).map(
        (id) => new Types.ObjectId(id),
      ),
    });

    const saved = await collection.save();

    // Apply conditions to all platform products
    this.applyCollectionToMatchingProducts(saved.id).catch(() => {});

    return saved;
  }

  async updatePlatformCollection(id: string, dto: UpdateCollectionDto) {
    const collection = await this.collectionModel.findOne({
      _id: id,
      scope: CollectionScope.PLATFORM,
    });
    if (!collection) throw new NotFoundException('Platform collection not found');

    // Convert string IDs to ObjectIds for manual overrides
    if (dto.manual_includes) {
      (collection as any).manual_includes = dto.manual_includes.map(
        (id) => new Types.ObjectId(id),
      );
    }
    if (dto.manual_excludes) {
      (collection as any).manual_excludes = dto.manual_excludes.map(
        (id) => new Types.ObjectId(id),
      );
    }

    const { manual_includes, manual_excludes, ...rest } = dto;
    Object.assign(collection, rest);
    const saved = await collection.save();

    if (dto.conditions || dto.manual_includes || dto.manual_excludes || dto.is_active !== undefined) {
      this.applyCollectionToMatchingProducts(saved.id).catch(() => {});
    }

    return saved;
  }

  async deletePlatformCollection(id: string) {
    const collection = await this.collectionModel.findOne({
      _id: id,
      scope: CollectionScope.PLATFORM,
    });
    if (!collection) throw new NotFoundException('Platform collection not found');

    await this.productModel.updateMany(
      { collections: collection._id },
      { $pull: { collections: collection._id } },
    );

    await this.collectionModel.findByIdAndDelete(id);
    return { deleted: true, id };
  }

  /**
   * Get active platform collections for homepage/explore (PUBLIC)
   */
  async getPlatformCollections() {
    return this.collectionModel
      .find({ scope: CollectionScope.PLATFORM, is_active: true })
      .sort({ sort_order: 1, createdAt: -1 })
      .lean();
  }

  /**
   * Get a platform collection with its matched products (PUBLIC)
   */
  async getPlatformCollectionWithProducts(
    idOrSlug: string,
    page = 1,
    limit = 20,
  ) {
    const isObjectId = Types.ObjectId.isValid(idOrSlug);
    const filter: any = {
      scope: CollectionScope.PLATFORM,
      is_active: true,
    };
    if (isObjectId) filter._id = idOrSlug;
    else filter.slug = idOrSlug;

    const collection = await this.collectionModel.findOne(filter).lean();
    if (!collection) throw new NotFoundException('Collection not found');

    const { take, skip } = await Utils.getPagination(page, limit);

    const [products, totalCount] = await Promise.all([
      this.productModel
        .find({ collections: collection._id })
        .skip(skip)
        .limit(take)
        .lean(),
      this.productModel.countDocuments({ collections: collection._id }),
    ]);

    return {
      collection,
      products: Utils.getPagingData(
        { count: totalCount, rows: products },
        page,
        limit,
      ),
    };
  }

  /**
   * Admin: get ALL platform collections (including inactive)
   */
  async getAllPlatformCollections() {
    return this.collectionModel
      .find({ scope: CollectionScope.PLATFORM })
      .sort({ sort_order: 1, createdAt: -1 })
      .lean();
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Evaluate a product against a collection's conditions.
   */
  private evaluateProductAgainstConditions(
    product: ProductDocument,
    collection: CollectionDocument,
  ): boolean {
    if (!collection.conditions?.length) return false;

    const matches = collection.conditions.map((cond) => {
      const productValue = this.getNestedValue(product, cond.field);
      return Array.isArray(productValue)
        ? productValue.some((v) =>
            this.evaluateOperator(v, cond.operator, cond.value),
          )
        : this.evaluateOperator(productValue, cond.operator, cond.value);
    });

    return collection.condition_match === 'all'
      ? matches.every((r) => r)
      : matches.some((r) => r);
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  /**
   * Helper: safely access nested values (supports arrays)
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current: any = obj;

    for (const key of keys) {
      if (Array.isArray(current)) {
        current = current
          .map((item) => item?.[key])
          .filter((v) => v !== undefined);
        if (current.length === 0) return undefined;
        if (current.length === 1) current = current[0];
      } else {
        current = current?.[key];
        if (current === undefined) return undefined;
      }
    }

    return current;
  }

  /**
   * Helper: evaluate operators
   */
  private evaluateOperator(
    value: any,
    operator: string,
    expected: any,
  ): boolean {
    switch (operator) {
      case 'is_equal_to':
        return value == expected;
      case 'not_equal_to':
        return value != expected;
      case 'greater_than':
        return Number(value) > Number(expected);
      case 'less_than':
        return Number(value) < Number(expected);
      case 'contains':
        return String(value).toLowerCase().includes(String(expected).toLowerCase());
      case 'starts_with':
        return String(value).toLowerCase().startsWith(String(expected).toLowerCase());
      case 'ends_with':
        return String(value).toLowerCase().endsWith(String(expected).toLowerCase());
      default:
        this.logger.warn(`Unknown operator "${operator}"`);
        return false;
    }
  }
}
