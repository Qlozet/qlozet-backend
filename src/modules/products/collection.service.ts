import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Collection, CollectionDocument, CollectionScope } from './schemas/collection.schema';
import { CreateCollectionDto, CreatePlatformCollectionDto, UpdateCollectionDto } from './dto/collection.dto';
import { Product, ProductDocument } from './schemas';
import { Utils } from '../../common/utils/pagination';

@Injectable()
export class CollectionService {
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
    console.log(
      '🟢 [CollectionService] Creating new collection:',
      createCollectionDto,
    );

    const collection = new this.collectionModel({
      ...createCollectionDto,
      business: new Types.ObjectId(business),
      condition_match: createCollectionDto.condition_match || 'all',
    });

    const savedCollection = await collection.save();
    console.log('✅ Collection saved successfully:', savedCollection._id);

    // Run product assignment in background
    this.applyCollectionToMatchingProducts(savedCollection.id)
      .then((result) => {
        console.log(
          `🎯 Applied collection ${savedCollection._id} to ${result.length} products`,
        );
      })
      .catch((err) => {
        console.error('❌ Error applying collection to products:', err);
      });

    const newCollection = savedCollection.toObject();
    return newCollection;
  }

  /**
   * Apply collection rules to all products and attach collection IDs
   */
  async applyCollectionToMatchingProducts(
    collectionId: string,
  ): Promise<ProductDocument[]> {
    console.log(
      '🟢 [applyCollectionToMatchingProducts] For collection ID:',
      collectionId,
    );

    const collection = await this.collectionModel.findById(collectionId).exec();
    if (!collection) throw new NotFoundException('Collection not found');
    if (!collection.is_active) {
      console.log('🚫 Collection is inactive, skipping:', collectionId);
      return [];
    }

    const products = await this.productModel.find().exec();
    console.log(`📦 Checking ${products.length} products for collection match`);

    const updatedProducts: ProductDocument[] = [];

    for (const product of products) {
      let isApplicable = false;

      if (collection.conditions?.length) {
        const matches = collection.conditions.map((cond) => {
          const productValue = this.getNestedValue(product, cond.field);
          const result = Array.isArray(productValue)
            ? productValue.some((v) =>
                this.evaluateOperator(v, cond.operator, cond.value),
              )
            : this.evaluateOperator(productValue, cond.operator, cond.value);

          console.log(
            `🔍 Product ${product._id} | ${cond.field} ${cond.operator} ${cond.value} | result=${result}`,
          );
          return result;
        });

        isApplicable =
          collection.condition_match === 'all'
            ? matches.every((r) => r)
            : matches.some((r) => r);
      }

      if (isApplicable) {
        if (!product.collections) product.collections = [];

        // Prevent duplicate collection IDs
        const collectionObjectId = new Types.ObjectId(collection.id);
        const alreadyExists = product.collections.some((id) =>
          id.equals(collectionObjectId),
        );

        if (!alreadyExists) {
          product.collections.push(collectionObjectId);
          await product.save();
          console.log(
            `💾 Product ${product._id} added to collection ${collectionId}`,
          );
          updatedProducts.push(product);
        } else {
          console.log(
            `⚠️ Product ${product._id} already in collection ${collectionId}`,
          );
        }
      } else {
        console.log(
          `🚫 Product ${product._id} does not meet collection conditions`,
        );
      }
    }

    console.log(
      `✅ Finished applying collection ${collectionId}. ${updatedProducts.length} products updated.`,
    );
    return updatedProducts;
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

    Object.assign(collection, dto);
    const saved = await collection.save();

    // Re-apply conditions if they changed
    if (dto.conditions) {
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

    Object.assign(collection, dto);
    const saved = await collection.save();

    if (dto.conditions) {
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
      default:
        console.warn(`⚠️ Unknown operator "${operator}"`);
        return false;
    }
  }
}
