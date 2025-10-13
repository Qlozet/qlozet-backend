import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Discount, DiscountDocument } from './schemas/discount.schema';
import { CreateDiscountDto } from './dto/discount.dto';
import { Product, ProductDocument } from './schemas';

@Injectable()
export class DiscountService {
  constructor(
    @InjectModel(Discount.name)
    private readonly discountModel: Model<DiscountDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(
    createDiscountDto: CreateDiscountDto,
  ): Promise<DiscountDocument> {
    const discount = new this.discountModel({
      ...createDiscountDto,
      condition_match: createDiscountDto.condition_match || 'all',
    });

    const savedDiscount = await discount.save();

    this.applyDiscountToMatchingProducts(savedDiscount.id).catch((err) => {
      console.error('Error applying discount to products:', err);
    });

    return savedDiscount.toJSON();
  }

  async findAll(): Promise<DiscountDocument[]> {
    return this.discountModel.find().exec();
  }

  async findActive(): Promise<DiscountDocument[]> {
    const now = new Date();
    return this.discountModel
      .find({
        start_date: { $lte: now },
        $or: [{ end_date: null }, { end_date: { $gte: now } }],
      })
      .exec();
  }
  async applyDiscountToMatchingProducts(
    discountId: string,
  ): Promise<ProductDocument[]> {
    // 1️⃣ Fetch the discount
    const discount = await this.discountModel.findById(discountId).exec();
    if (!discount) throw new NotFoundException('Discount not found');
    if (!discount.is_active) return [];

    const now = new Date();
    if (discount.start_date && discount.start_date > now) return [];
    if (discount.end_date && discount.end_date < now) return [];

    // 2️⃣ Fetch all products
    const products = await this.productModel.find().exec();
    const updatedProducts: ProductDocument[] = [];

    // 3️⃣ Loop through products and check conditions
    for (const product of products) {
      let isApplicable = false;

      if (discount.type === 'store_wide') {
        isApplicable = true;
      } else if (discount.conditions?.length) {
        const matches = discount.conditions.map((cond) => {
          const value = this.getNestedValue(product, cond.field);
          if (Array.isArray(value)) {
            return value.some((v) =>
              this.evaluateOperator(v, cond.operator, cond.value),
            );
          } else {
            return this.evaluateOperator(value, cond.operator, cond.value);
          }
        });

        isApplicable =
          discount.condition_match === 'all'
            ? matches.every((r) => r)
            : matches.some((r) => r);
      }

      // 4️⃣ Apply discount if applicable
      if (isApplicable) {
        if (!product.applied_discounts) product.applied_discounts = [];
        if (!product.applied_discounts.includes(discount.id)) {
          product.applied_discounts.push(discount.id);
        }

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
        await product.save();
        updatedProducts.push(product);
      }
    }

    return updatedProducts;
  }

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
        return false;
    }
  }
}
