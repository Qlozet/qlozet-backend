import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Discount, DiscountDocument } from './schemas/discount.schema';
import { CreateDiscountDto } from './dto/discount.dto';
import { Product, ProductDocument } from './schemas';
import { Utils } from 'src/common/utils/pagination';
import { ProductKind } from './schemas/product.schema';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class DiscountService {
  private readonly logger = new Logger(DiscountService.name);

  constructor(
    @InjectModel(Discount.name)
    private readonly discountModel: Model<DiscountDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  // ─────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────

  /** Get all discounts for a business (paginated) */
  async findAll(
    business: string,
    query?: { page?: number; size?: number },
  ) {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);

    const filter = { business: new Types.ObjectId(business) };

    const [discounts, totalCount] = await Promise.all([
      this.discountModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(take).exec(),
      this.discountModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: discounts },
      page,
      size,
    );
  }

  /** Get only currently active discounts for a business */
  async findActive(
    business: string,
    query?: { page?: number; size?: number },
  ) {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);

    const now = new Date();
    const filter = {
      business: new Types.ObjectId(business),
      is_active: true,
      $or: [
        { start_date: null },
        { start_date: { $lte: now } },
      ],
      $and: [
        {
          $or: [
            { end_date: null },
            { end_date: { $gte: now } },
          ],
        },
      ],
    };

    const [discounts, totalCount] = await Promise.all([
      this.discountModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(take).exec(),
      this.discountModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: discounts },
      page,
      size,
    );
  }

  /** Get a single discount by ID */
  async findById(id: string, business: string) {
    const discount = await this.discountModel.findOne({
      _id: id,
      business: new Types.ObjectId(business),
    });
    if (!discount) throw new NotFoundException('Discount not found');
    return discount;
  }

  // ─────────────────────────────────────────────────────────
  // CREATE / UPDATE / DELETE
  // ─────────────────────────────────────────────────────────

  /** Create discount and trigger async apply */
  async create(
    createDiscountDto: CreateDiscountDto,
    business: string,
  ): Promise<DiscountDocument> {
    this.logger.log(`Creating discount: type=${createDiscountDto.type}, value=${createDiscountDto.value}`);

    const discount = new this.discountModel({
      ...createDiscountDto,
      business: new Types.ObjectId(business),
      condition_match: createDiscountDto.condition_match || 'all',
    });

    const savedDiscount = await discount.save();
    this.logger.log(`Discount created: ${savedDiscount._id}`);

    // Run background discount application
    this.applyDiscountToMatchingProducts(savedDiscount.id)
      .then((count) =>
        this.logger.log(
          `Applied discount ${savedDiscount._id} to ${count} products`,
        ),
      )
      .catch((err) =>
        this.logger.error('Failed to apply discount to products', err),
      );

    return savedDiscount.toObject();
  }

  /** Update an existing discount */
  async update(
    id: string,
    dto: Partial<CreateDiscountDto>,
    business: string,
  ) {
    const discount = await this.discountModel.findOne({
      _id: id,
      business: new Types.ObjectId(business),
    });
    if (!discount) throw new NotFoundException('Discount not found');

    Object.assign(discount, dto);
    const saved = await discount.save();

    // Re-apply if conditions, value, type, or active status changed
    if (dto.conditions || dto.value !== undefined || dto.type || dto.is_active !== undefined) {
      this.applyDiscountToMatchingProducts(saved.id).catch(() => {});
    }

    return saved;
  }

  /** Delete a discount and clean up all products that had it applied */
  async delete(id: string, business: string) {
    const discount = await this.discountModel.findOne({
      _id: id,
      business: new Types.ObjectId(business),
    });
    if (!discount) throw new NotFoundException('Discount not found');

    // Remove discount from all products
    await this.productModel.updateMany(
      { applied_discount: discount._id },
      {
        $set: {
          applied_discount: null,
          discounted_price: null,
          discount_percentage: null,
        },
      },
    );

    await this.discountModel.findByIdAndDelete(id);
    return { deleted: true, id };
  }

  // ─────────────────────────────────────────────────────────
  // DISCOUNT APPLICATION ENGINE
  // ─────────────────────────────────────────────────────────

  /**
   * Apply a discount to all matching products.
   * - Scoped to vendor's products only (not all products in the DB)
   * - Calculates and stores discounted_price + discount_percentage on each product
   * - Removes discount from products that no longer match
   * - Picks the best discount if a product already has one (highest savings wins)
   */
  async applyDiscountToMatchingProducts(
    discountId: string,
  ): Promise<number> {
    this.logger.log(`Applying discount: ${discountId}`);

    const discount = await this.discountModel.findById(discountId).exec();
    if (!discount) throw new NotFoundException('Discount not found');

    const now = new Date();
    if (!discount.is_active) {
      this.logger.warn(`Discount inactive, skipping: ${discountId}`);
      return 0;
    }
    if (discount.start_date && discount.start_date > now) {
      this.logger.warn(`Discount not started yet: ${discount.start_date}`);
      return 0;
    }
    if (discount.end_date && discount.end_date < now) {
      this.logger.warn(`Discount expired: ${discount.end_date}`);
      return 0;
    }

    // Scope to vendor's products only
    const products = await this.productModel
      .find({ business: discount.business })
      .exec();
    this.logger.log(`Checking ${products.length} products for discount match`);

    let updatedCount = 0;

    for (const product of products) {
      const basePrice = product.base_price || 0;
      let isApplicable = false;

      // Store-wide discount applies to everything
      if (discount.type === 'store_wide') {
        isApplicable = true;
      }
      // Conditional discounts
      else if (discount.conditions?.length) {
        const results = discount.conditions.map((cond) => {
          const productValue = this.getNestedValue(product, cond.field);
          return Array.isArray(productValue)
            ? productValue.some((v) =>
                this.evaluateOperator(v, cond.operator, cond.value),
              )
            : this.evaluateOperator(productValue, cond.operator, cond.value);
        });

        isApplicable =
          discount.condition_match === 'all'
            ? results.every(Boolean)
            : results.some(Boolean);
      }

      const currentDiscountId = product.applied_discount?.toString();
      const thisDiscountId = String(discount._id);

      if (isApplicable) {
        // Calculate discount amount for this product
        const { discountedPrice, savingsPercent } = this.calculateDiscountedPrice(
          basePrice,
          discount,
        );

        // Check if product already has a different discount — pick the best one
        if (currentDiscountId && currentDiscountId !== thisDiscountId) {
          const existingDiscount = await this.discountModel.findById(currentDiscountId).lean();
          if (existingDiscount) {
            const existingSavings = this.calculateDiscountedPrice(
              basePrice,
              existingDiscount,
            );
            // If the existing discount saves more money, skip this one
            if (existingSavings.discountedPrice <= discountedPrice) {
              continue;
            }
          }
        }

        await this.productModel.updateOne(
          { _id: product._id },
          {
            $set: {
              applied_discount: discount._id,
              discounted_price: Math.round(discountedPrice * 100) / 100,
              discount_percentage: Math.round(savingsPercent * 100) / 100,
            },
          },
        );
        updatedCount++;
      } else if (currentDiscountId === thisDiscountId) {
        // Product no longer matches — remove this discount
        await this.productModel.updateOne(
          { _id: product._id },
          {
            $set: {
              applied_discount: null,
              discounted_price: null,
              discount_percentage: null,
            },
          },
        );
        updatedCount++;
      }
    }

    this.logger.log(
      `Finished applying discount ${discountId}. ${updatedCount} products updated.`,
    );
    return updatedCount;
  }

  /**
   * Sync a single product against all active discounts for its vendor.
   * Picks the discount that gives the biggest savings.
   */
  async syncProductWithDiscounts(productId: string): Promise<void> {
    const product = await this.productModel.findById(productId).exec();
    if (!product) return;

    const businessId = product.business?.toString();
    if (!businessId) return;

    const now = new Date();
    const activeDiscounts = await this.discountModel
      .find({
        business: new Types.ObjectId(businessId),
        is_active: true,
        $or: [{ start_date: null }, { start_date: { $lte: now } }],
      })
      .exec();

    // Filter out expired discounts
    const validDiscounts = activeDiscounts.filter(
      (d) => !d.end_date || d.end_date >= now,
    );

    const basePrice = product.base_price || 0;
    let bestDiscount: DiscountDocument | null = null;
    let bestPrice = basePrice;
    let bestPercent = 0;

    for (const discount of validDiscounts) {
      let isApplicable = false;

      if (discount.type === 'store_wide') {
        isApplicable = true;
      } else if (discount.conditions?.length) {
        const results = discount.conditions.map((cond) => {
          const productValue = this.getNestedValue(product, cond.field);
          return Array.isArray(productValue)
            ? productValue.some((v) =>
                this.evaluateOperator(v, cond.operator, cond.value),
              )
            : this.evaluateOperator(productValue, cond.operator, cond.value);
        });

        isApplicable =
          discount.condition_match === 'all'
            ? results.every(Boolean)
            : results.some(Boolean);
      }

      if (isApplicable) {
        const { discountedPrice, savingsPercent } = this.calculateDiscountedPrice(
          basePrice,
          discount,
        );
        // Pick the discount that saves the customer the most money
        if (discountedPrice < bestPrice) {
          bestDiscount = discount;
          bestPrice = discountedPrice;
          bestPercent = savingsPercent;
        }
      }
    }

    if (bestDiscount) {
      await this.productModel.updateOne(
        { _id: product._id },
        {
          $set: {
            applied_discount: bestDiscount._id,
            discounted_price: Math.round(bestPrice * 100) / 100,
            discount_percentage: Math.round(bestPercent * 100) / 100,
          },
        },
      );
    } else if (product.applied_discount) {
      // No discount applies anymore — clear it
      await this.productModel.updateOne(
        { _id: product._id },
        {
          $set: {
            applied_discount: null,
            discounted_price: null,
            discount_percentage: null,
          },
        },
      );
    }
  }

  /**
   * Event listener: auto-sync discounts when a product is created or updated.
   */
  @OnEvent('product.upserted', { async: true })
  async handleProductUpserted(product: any): Promise<void> {
    const productId = product._id?.toString?.() || product._id;
    if (!productId) return;

    this.logger.log(`[Event] product.upserted → syncing discounts for ${productId}`);
    try {
      await this.syncProductWithDiscounts(productId);
    } catch (err) {
      this.logger.error(`Failed to sync discounts for product ${productId}:`, err);
    }
  }

  // ─────────────────────────────────────────────────────────
  // CRON JOB
  // ─────────────────────────────────────────────────────────

  /** Cron job: runs every 10 minutes to activate/expire discounts */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async refreshDiscountsJob() {
    this.logger.log('Running scheduled discount refresh job...');
    const now = new Date();

    const allDiscounts = await this.discountModel.find().exec();
    for (const discount of allDiscounts) {
      const shouldBeActive =
        (!discount.start_date || discount.start_date <= now) &&
        (!discount.end_date || discount.end_date >= now);

      if (shouldBeActive && !discount.is_active) {
        // Activate a discount that has reached its start date
        discount.is_active = true;
        await discount.save();
        this.logger.log(`Activated discount ${discount._id}`);
        await this.applyDiscountToMatchingProducts(discount.id);
      }

      if (!shouldBeActive && discount.is_active) {
        // Expire a discount that has passed its end date
        discount.is_active = false;
        await discount.save();
        this.logger.log(`Expired discount ${discount._id}`);

        // Clean up: remove discount from all products that had it
        await this.productModel.updateMany(
          { applied_discount: discount._id },
          {
            $set: {
              applied_discount: null,
              discounted_price: null,
              discount_percentage: null,
            },
          },
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // DISCOUNTED PRODUCT QUERIES
  // ─────────────────────────────────────────────────────────

  /** Get all products with currently active discounts */
  async getDiscountedProducts(
    business: string,
    query?: { page?: number; size?: number },
  ) {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);

    const filter = {
      business: new Types.ObjectId(business),
      applied_discount: { $ne: null },
      discounted_price: { $ne: null },
    };

    const [products, totalCount] = await Promise.all([
      this.productModel
        .find(filter)
        .skip(skip)
        .limit(take)
        .populate('applied_discount')
        .lean()
        .exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: products },
      page,
      size,
    );
  }

  /** Get discounted products per vendor */
  async getDiscountedProductsByVendor(
    business: string,
    query?: { page?: number; size?: number; kind?: ProductKind },
  ) {
    const { page = 1, size = 10, kind } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);
    const filter: any = {
      business: new Types.ObjectId(business),
      applied_discount: { $ne: null },
    };
    if (kind) filter.kind = kind;

    const [products, totalCount] = await Promise.all([
      this.productModel
        .find(filter)
        .skip(skip)
        .limit(take)
        .populate('applied_discount')
        .lean()
        .exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: products },
      page,
      size,
    );
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  /**
   * Calculate the final discounted price and savings percentage.
   */
  private calculateDiscountedPrice(
    basePrice: number,
    discount: any,
  ): { discountedPrice: number; savingsPercent: number } {
    if (!basePrice || basePrice <= 0) {
      return { discountedPrice: 0, savingsPercent: 0 };
    }

    let discountAmount = 0;

    switch (discount.type) {
      case 'percentage':
      case 'flash_percentage':
      case 'store_wide':
        // Store-wide uses value_type to determine if it's percentage or fixed
        // Default to percentage if value_type is not set for store_wide
        if (discount.type === 'store_wide' && discount.value_type === 'fixed') {
          discountAmount = discount.value || 0;
        } else {
          discountAmount = (basePrice * (discount.value || 0)) / 100;
        }
        break;

      case 'fixed':
      case 'flash_fixed':
        discountAmount = discount.value || 0;
        break;

      case 'category_specific':
        if (discount.value_type === 'percentage') {
          discountAmount = (basePrice * (discount.value || 0)) / 100;
        } else {
          discountAmount = discount.value || 0;
        }
        break;

      default:
        discountAmount = 0;
    }

    // Cap discount at the base price (can't go below ₦0)
    discountAmount = Math.min(discountAmount, basePrice);

    const discountedPrice = basePrice - discountAmount;
    const savingsPercent = (discountAmount / basePrice) * 100;

    return { discountedPrice, savingsPercent };
  }

  /** Helper: safely get nested object fields (supports arrays) */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current: any = obj;
    for (const key of keys) {
      if (Array.isArray(current)) {
        current = current.map((i) => i?.[key]).filter((v) => v !== undefined);
        if (current.length === 0) return undefined;
        if (current.length === 1) current = current[0];
      } else {
        current = current?.[key];
        if (current === undefined) return undefined;
      }
    }
    return current;
  }

  /** Helper: evaluate conditional operators */
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
