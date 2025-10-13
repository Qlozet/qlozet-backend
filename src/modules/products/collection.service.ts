import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Collection, CollectionDocument } from './schemas/collection.schema';
import { CreateCollectionDto } from './dto/collection.dto';
import { Product, ProductDocument } from './schemas';

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
    vendor: string,
  ): Promise<CollectionDocument> {
    console.log(
      '🟢 [CollectionService] Creating new collection:',
      createCollectionDto,
    );

    const collection = new this.collectionModel({
      ...createCollectionDto,
      vendor,
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

    return savedCollection.toJSON();
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
  ): Promise<ProductDocument[]> {
    return this.productModel
      .find({ collections: collectionId })
      .populate('collections')
      .exec();
  }

  /**
   * Get all collections and their products by vendor
   */
  async getCollectionsWithProductsByVendor(
    vendorId: string,
  ): Promise<
    { collection: CollectionDocument; products: ProductDocument[] }[]
  > {
    const collections = await this.collectionModel
      .find({ vendor: vendorId })
      .exec();

    // ✅ Explicitly type the result array
    const result: {
      collection: CollectionDocument;
      products: ProductDocument[];
    }[] = [];

    for (const collection of collections) {
      const products = await this.productModel
        .find({ vendor: vendorId, collections: collection._id })
        .populate('collections')
        .exec();

      result.push({ collection, products });
    }

    return result;
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
