import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Discount, DiscountDocument } from './schemas/discount.schema';
import { CreateDiscountDto } from './dto/discount.dto';
import { Product, ProductDocument } from './schemas';
import { Utils } from 'src/common/utils/pagination';
import { ProductKind } from './schemas/product.schema';

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
  async findAll(
    business: string,
    query?: { page?: number; size?: number },
  ): Promise<{
    total_items: number;
    data: DiscountDocument[];
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);

    const filter = { business: new Types.ObjectId(business) };

    const [discounts, totalCount] = await Promise.all([
      this.discountModel.find(filter).skip(skip).limit(take).exec(),
      this.discountModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: discounts },
      page,
      size,
    );
  }

  async findActive(
    business: string,
    query?: { page?: number; size?: number },
  ): Promise<{
    total_items: number;
    data: DiscountDocument[];
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);

    const now = new Date();
    const filter = {
      business: new Types.ObjectId(business),
      start_date: { $lte: now },
      $or: [{ end_date: null }, { end_date: { $gte: now } }],
      is_active: true,
    };

    const [discounts, totalCount] = await Promise.all([
      this.discountModel.find(filter).skip(skip).limit(take).exec(),
      this.discountModel.countDocuments(filter),
    ]);

    return Utils.getPagingData(
      { count: totalCount, rows: discounts },
      page,
      size,
    );
  }

  /** 🔹 Create discount and trigger async apply */
  async create(
    createDiscountDto: CreateDiscountDto,
    business: string,
  ): Promise<DiscountDocument> {
    this.logger.log(`Creating discount: ${JSON.stringify(createDiscountDto)}`);

    const discount = new this.discountModel({
      ...createDiscountDto,
      business: new Types.ObjectId(business),
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
    this.logger.log(`Applying discount: ${discountId}`);

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

      // 3️⃣ Avoid duplicate application
      const alreadyHasDiscount =
        product.applied_discount &&
        product.applied_discount.toString() === discount.id.toString();

      if (alreadyHasDiscount) {
        this.logger.debug(`Product ${product._id} already has this discount`);
        continue;
      }

      // 4️⃣ Apply discount calculation
      const basePrice = product.base_price || 0;
      let discountValue = 0;

      if (
        ['percentage', 'flash_percentage', 'store_wide'].includes(discount.type)
      ) {
        discountValue = discount.value;
      } else {
        discountValue = discount.value;
      }

      const finalPrice = Math.max(basePrice - discountValue, 0);

      await this.productModel.updateOne(
        { _id: product._id },
        {
          $set: {
            applied_discount: discount._id,
          },
        },
      );

      updatedProducts.push(product);
      this.logger.log(
        `✅ Applied discount ${discount._id} to product ${product._id}, new price: ${finalPrice}`,
      );
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
  async getDiscountedProducts(
    business: string,
    query?: { page?: number; size?: number },
  ) {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);
    const now = new Date();

    // 1️⃣ Get all active discounts for this business
    const activeDiscounts = await this.discountModel
      .find({
        business,
        is_active: true,
        start_date: { $lte: now },
        $or: [{ end_date: null }, { end_date: { $gte: now } }],
      })
      .select('_id')
      .lean()
      .exec();

    if (!activeDiscounts.length) {
      return Utils.getPagingData({ count: 0, rows: [] }, page, size);
    }

    const discountIds = activeDiscounts.map((d) => d._id);

    // 2️⃣ Find products that have these active discounts
    const [products, totalCount] = await Promise.all([
      this.productModel
        .find({ business, applied_discounts: { $in: discountIds } })
        .skip(skip)
        .limit(take)
        .populate('applied_discounts')
        .lean()
        .exec(),
      this.productModel.countDocuments({
        business,
        applied_discounts: { $in: discountIds },
      }),
    ]);

    // 3️⃣ Return paginated result
    return Utils.getPagingData(
      { count: totalCount, rows: products },
      page,
      size,
    );
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

  /** 🔹 Get discounted products per vendor */
  async getDiscountedProductsByVendor(
    business: string,
    query?: { page?: number; size?: number; kind?: ProductKind },
  ) {
    const { page = 1, size = 10, kind } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);
    const filter: any = {
      business,
      applied_discount: { $ne: null },
    };
    if (kind) filter.kind = kind;

    // Get products and total count in parallel
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

    // Return paginated data
    return Utils.getPagingData(
      { count: totalCount, rows: products },
      page,
      size,
    );
  }
}
