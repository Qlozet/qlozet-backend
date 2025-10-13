import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Discount, DiscountDocument } from './schemas/discount.schema';
import { CreateDiscountDto } from './dto/discount.dto';
import { Product, ProductDocument } from './schemas';

@Injectable()
export class DiscountService {
  private readonly logger = new Logger(DiscountService.name);

  constructor(
    @InjectModel(Discount.name)
    private readonly discountModel: Model<DiscountDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  /** 🔹 Get all discounts */
  async findAll(): Promise<DiscountDocument[]> {
    return this.discountModel.find().exec();
  }

  /** 🔹 Get only active discounts */
  async findActive(): Promise<DiscountDocument[]> {
    const now = new Date();
    return this.discountModel
      .find({
        start_date: { $lte: now },
        $or: [{ end_date: null }, { end_date: { $gte: now } }],
        is_active: true,
      })
      .exec();
  }

  /** 🔹 Create discount and trigger async apply */
  async create(
    createDiscountDto: CreateDiscountDto,
    vendor: string,
  ): Promise<DiscountDocument> {
    this.logger.log(`Creating discount: ${JSON.stringify(createDiscountDto)}`);

    const discount = new this.discountModel({
      ...createDiscountDto,
      vendor,
      condition_match: createDiscountDto.condition_match || 'all',
    });

    const savedDiscount = await discount.save();
    this.logger.log(`✅ Discount created successfully: ${savedDiscount._id}`);

    // Run background discount application
    this.applyDiscountToMatchingProducts(savedDiscount.id)
      .then((updated) =>
        this.logger.log(
          `🎯 Applied discount to ${updated.length} matching products (${savedDiscount._id})`,
        ),
      )
      .catch((err) =>
        this.logger.error('❌ Failed to apply discount to products', err),
      );

    return savedDiscount.toJSON();
  }

  /** 🔹 Apply discount to products that match its conditions */
  async applyDiscountToMatchingProducts(
    discountId: string,
  ): Promise<ProductDocument[]> {
    this.logger.log(`Applying discount to products: ${discountId}`);

    const discount = await this.discountModel.findById(discountId).exec();
    if (!discount) throw new NotFoundException('Discount not found');

    const now = new Date();
    if (!discount.is_active) {
      this.logger.warn(`Discount inactive, skipping: ${discountId}`);
      return [];
    }
    if (discount.start_date && discount.start_date > now) {
      this.logger.warn(`Discount not started yet: ${discount.start_date}`);
      return [];
    }
    if (discount.end_date && discount.end_date < now) {
      this.logger.warn(`Discount expired: ${discount.end_date}`);
      return [];
    }

    const products = await this.productModel.find().exec();
    this.logger.log(`Found ${products.length} products to check`);

    const updatedProducts: ProductDocument[] = [];

    for (const product of products) {
      let isApplicable = false;

      // 1️⃣ Store-wide discount
      if (discount.type === 'store_wide') {
        isApplicable = true;
      }

      // 2️⃣ Conditional discounts
      else if (discount.conditions?.length) {
        const results = discount.conditions.map((cond) => {
          const productValue = this.getNestedValue(product, cond.field);
          const result = Array.isArray(productValue)
            ? productValue.some((v) =>
                this.evaluateOperator(v, cond.operator, cond.value),
              )
            : this.evaluateOperator(productValue, cond.operator, cond.value);

          this.logger.debug(
            `Check product ${product._id}: ${cond.field} ${cond.operator} ${cond.value} => ${result}`,
          );
          return result;
        });

        isApplicable =
          discount.condition_match === 'all'
            ? results.every(Boolean)
            : results.some(Boolean);
      }

      if (!isApplicable) continue;

      // 3️⃣ Avoid duplicate discount IDs
      if (!product.applied_discounts) product.applied_discounts = [];
      const existingIds = product.applied_discounts.map((id) => id.toString());
      if (existingIds.includes(discount.id)) continue;

      // 4️⃣ Apply discount calculation
      let finalPrice = product.base_price;
      switch (discount.type) {
        case 'fixed':
        case 'flash_fixed':
          finalPrice -= discount.value;
          break;
        case 'percentage':
        case 'flash_percentage':
        case 'store_wide':
          finalPrice -= (discount.value / 100) * finalPrice;
          break;
        case 'category_specific':
          if (discount.value_type === 'fixed') {
            finalPrice -= discount.value;
          } else {
            finalPrice -= (discount.value / 100) * finalPrice;
          }
          break;
      }

      product.discounted_price = Math.max(finalPrice, 0);
      product.applied_discounts.push(discount.id);

      try {
        await product.save();
        updatedProducts.push(product);
      } catch (err) {
        this.logger.error(
          `Failed to save product ${product._id}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `✅ Finished applying discount to ${updatedProducts.length} products`,
    );
    return updatedProducts;
  }

  /** 🔹 Cron job: runs every 10 minutes to refresh discounts */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async refreshDiscountsJob() {
    this.logger.log('🕒 Running scheduled discount refresh job...');
    const now = new Date();

    const allDiscounts = await this.discountModel.find().exec();
    for (const discount of allDiscounts) {
      const shouldBeActive =
        (!discount.start_date || discount.start_date <= now) &&
        (!discount.end_date || discount.end_date >= now);

      if (shouldBeActive && !discount.is_active) {
        discount.is_active = true;
        await discount.save();
        this.logger.log(`✅ Activated discount ${discount.id}`);
        await this.applyDiscountToMatchingProducts(discount.id);
      }

      if (!shouldBeActive && discount.is_active) {
        discount.is_active = false;
        await discount.save();
        this.logger.warn(`🚫 Expired discount ${discount._id}`);
      }
    }
  }

  /** 🔹 Get all products with currently active discounts */
  async getDiscountedProducts(): Promise<ProductDocument[]> {
    const now = new Date();
    const activeDiscounts = await this.discountModel
      .find({
        is_active: true,
        start_date: { $lte: now },
        $or: [{ end_date: null }, { end_date: { $gte: now } }],
      })
      .select('_id')
      .exec();

    if (!activeDiscounts.length) return [];

    const discountIds = activeDiscounts.map((d) => d._id);
    return this.productModel
      .find({ applied_discounts: { $in: discountIds } })
      .exec();
  }

  /** 🔹 Helper: safely get nested object fields (supports arrays) */
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

  /** 🔹 Helper: evaluate conditional operators */
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
        this.logger.warn(`⚠️ Unknown operator "${operator}"`);
        return false;
    }
  }
  /**
   * Get discounted products per vendor
   */
  async getDiscountedProductsByVendor(
    vendorId: string,
  ): Promise<ProductDocument[]> {
    return this.productModel
      .find({
        vendor: vendorId,
        discounted_price: { $gt: 0 },
        applied_discounts: { $exists: true, $ne: [] },
      })
      .populate('applied_discounts')
      .exec();
  }
}
