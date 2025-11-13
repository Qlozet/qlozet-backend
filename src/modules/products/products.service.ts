// product.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Discount,
  DiscountDocument,
  Product,
  ProductDocument,
} from './schemas';
import { CreateProductDto } from './dto';
import { Utils } from '../../common/utils/pagination';
import { ClothingType } from './dto/clothing.dto';
import { Type } from 'class-transformer';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  /**
   * Create a product and compute its price dynamically based on type
   */
  async create(
    createProductDto: CreateProductDto,
    business: Types.ObjectId,
    kind: string,
  ): Promise<{ data: ProductDocument; message: string }> {
    let totalPrice = 0;
    if (kind === 'clothing') {
      totalPrice = this.computeClothingPrice(createProductDto);
    } else if (kind === 'accessory') {
      totalPrice = this.computeAccessoryPrice(createProductDto);
    } else if (kind === 'fabric') {
      totalPrice = this.computeFabricPrice(createProductDto);
    }
    console.log(business, 'UY');
    const createdProduct = new this.productModel({
      ...createProductDto,
      business,
      kind,
      base_price: totalPrice,
    });

    await createdProduct.save();
    return {
      data: createdProduct.toJSON(),
      message: 'Product created successfully',
    };
  }

  /**
   * Get all products
   */
  async findAll(
    page: number = 1,
    size: number = 10,
    kind?: string,
    search?: string,
    sortBy?: 'rating' | 'date' | 'relevance',
    order: 'asc' | 'desc' = 'desc',
  ) {
    const filter: any = {};

    if (kind) filter.kind = kind;

    if (search) {
      filter.$or = [
        { 'clothing.name': { $regex: search, $options: 'i' } },
        { 'accessory.name': { $regex: search, $options: 'i' } },
        { 'fabric.name': { $regex: search, $options: 'i' } },
      ];
      filter.$or.push(
        { 'clothing.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'accessory.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'fabric.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'clothing.taxonomy.attributes': { $regex: search, $options: 'i' } },
        { 'accessory.taxonomy.attributes': { $regex: search, $options: 'i' } },
        { 'fabric.taxonomy.attributes': { $regex: search, $options: 'i' } },
      );
    }

    const { take, skip } = await Utils.getPagination(page, size);

    // Determine sort order
    const sortOrder = order === 'asc' ? 1 : -1;
    let sort: Record<string, 1 | -1> = {};

    switch (sortBy) {
      case 'rating':
        sort = { average_rating: sortOrder }; // ascending or descending rating
        break;
      case 'date':
        sort = { createdAt: sortOrder }; // ascending or descending date
        break;
      case 'relevance':
        sort = search
          ? { average_rating: -1, createdAt: -1 }
          : { createdAt: -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    const [rows, count] = await Promise.all([
      this.productModel.find(filter).sort(sort).skip(skip).limit(take).exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

  /**
   * Get a product by ID
   */
  async findById(id: string): Promise<ProductDocument> {
    const product = await this.productModel.findById(id).exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /**
   * Delete a product
   */
  async delete(id: string, vendor: string): Promise<void> {
    const deleted = await this.productModel.findOneAndDelete({
      _id: new Types.ObjectId(id),
    });

    if (!deleted) {
      throw new NotFoundException(
        'Product not found or you do not have permission to delete this product',
      );
    }
  }

  // 💰 Helper methods

  private computeClothingPrice(dto: any): number {
    const clothing = dto?.clothing;
    if (!clothing) return 0;

    const isCustomize = clothing?.type === ClothingType.CUSTOMIZE;
    let total = 0;
    console.log(isCustomize, 'TYPE');
    // --- CUSTOMIZE ---
    if (isCustomize) {
      const hasFabric =
        Array.isArray(clothing.fabrics) && clothing.fabrics.length > 0;
      const hasColorVariants =
        Array.isArray(clothing.color_variants) &&
        clothing.color_variants.length > 0;
      const hasStyles =
        Array.isArray(clothing.styles) && clothing.styles.length > 0;
      const hasAccessories =
        Array.isArray(clothing.accessories) && clothing.accessories.length > 0;

      // ✅ Validate rules
      if (!hasStyles)
        throw new Error('Styles are required for customized clothing.');
      if (hasFabric && hasColorVariants)
        throw new Error(
          'Customized clothing cannot have both fabric and color variants.',
        );

      // 🎨 Styles (required)
      total += clothing.styles.reduce((sum, s) => sum + (s.price || 0), 0);

      // 🧵 Fabric (optional)
      if (hasFabric) {
        total += clothing.fabrics.reduce((sum, fabric) => {
          const fabricBase =
            (fabric.price_per_yard || 0) * (fabric.yard_length || 0);
          const variantTotal = Array.isArray(fabric.variants)
            ? fabric.variants.reduce(
                (vSum, v) => vSum + (v.price || 0) * (v.stock || 0),
                0,
              )
            : 0;
          return sum + fabricBase + variantTotal;
        }, 0);
      }

      // 🎨 Color Variants (optional, exclusive with fabric)
      else if (hasColorVariants) {
        total += clothing.color_variants.reduce((sum, color) => {
          const colorSum = Array.isArray(color.variants)
            ? color.variants.reduce(
                (vSum, v) => vSum + (v.price || 0) * (v.stock || 0),
                0,
              )
            : 0;
          return sum + colorSum;
        }, 0);
      }

      // 🧷 Accessories (optional)
      if (hasAccessories) {
        total += clothing.accessories.reduce((sum, accessory) => {
          const basePrice = accessory.price || 0;
          const variantStock =
            accessory.variants?.reduce((vSum, v) => vSum + (v.stock || 0), 0) ||
            0;
          const accessoryTotal = variantStock
            ? variantStock * basePrice
            : basePrice;
          return sum + accessoryTotal;
        }, 0);
      }

      return total;
    }

    // --- NON-CUSTOMIZE ---
    const hasFabric =
      Array.isArray(clothing.fabrics) && clothing.fabrics.length > 0;
    const hasStyles =
      Array.isArray(clothing.styles) && clothing.styles.length > 0;
    const hasAccessories =
      Array.isArray(clothing.accessories) && clothing.accessories.length > 0;

    if (hasFabric || hasStyles || hasAccessories)
      throw new BadRequestException(
        'Fabric, styles, and accessories are not allowed for non-customized clothing.',
      );

    if (Array.isArray(clothing.color_variants)) {
      total += clothing.color_variants.reduce((sum, color) => {
        const colorSum = Array.isArray(color.variants)
          ? color.variants.reduce(
              (vSum, v) => vSum + (v.price || 0) * (v.stock || 0),
              0,
            )
          : 0;
        return sum + colorSum;
      }, 0);
    }

    return total;
  }

  private computeAccessoryPrice(dto: any): number {
    const accessory = dto?.accessory;
    if (!accessory) return 0;

    const basePrice = accessory.price || 0;
    const variantStock =
      Array.isArray(accessory.variants) && accessory.variants.length > 0
        ? accessory.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
        : 0;
    const total = variantStock > 0 ? basePrice * variantStock : basePrice;

    return total;
  }

  private computeFabricPrice(dto: any): number {
    const fabric = dto?.fabric;
    if (!fabric.price_per_yard || !fabric.yard_length) {
      throw new BadRequestException(
        'Fabric must have both yard_length and price_per_yard',
      );
    }
    const effectiveLength = Math.max(fabric.yard_length, fabric.min_cut || 0);
    const total = fabric.price_per_yard * effectiveLength;

    return total;
  }

  async findByVendor(
    vendor: string,
    kind: string,
    page: number = 1,
    size: number = 10,
  ) {
    const filter: any = {};
    if (kind) {
      filter.kind = kind;
    }
    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.productModel
        .find({ ...filter, vendor })
        .skip(skip)
        .limit(take)
        .exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
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

    return {
      average: product.average_rating,
      total_reviews: product.ratings.length,
      ratings: product.ratings,
    };
  }
}
