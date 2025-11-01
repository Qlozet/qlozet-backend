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

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,

    @InjectModel(Discount.name)
    private readonly discountModel: Model<DiscountDocument>,
  ) {}

  /**
   * Create a product and compute its price dynamically based on type
   */
  async create(
    createProductDto: CreateProductDto,
    vendor: string,
    kind: string,
  ): Promise<{ data: ProductDocument; message: string }> {
    let totalPrice = 0;
    await this.productModel.deleteMany();
    if (kind === 'clothing') {
      totalPrice = this.computeClothingPrice(createProductDto);
    } else if (kind === 'accessory') {
      totalPrice = this.computeAccessoryPrice(createProductDto);
    } else if (kind === 'fabric') {
      totalPrice = this.computeFabricPrice(createProductDto);
    }
    const createdProduct = new this.productModel({
      ...createProductDto,
      vendor,
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
  ) {
    const filter: any = {};

    if (kind) filter.kind = kind;

    if (search) {
      filter.$or = [
        { 'clothing.name': { $regex: search, $options: 'i' } },
        { 'accessory.name': { $regex: search, $options: 'i' } },
        { 'fabric.name': { $regex: search, $options: 'i' } },
      ];
    }

    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.productModel
        .find(filter)
        .skip(skip)
        .limit(take)
        .populate('vendor', 'name email')
        .exec(),
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
}
