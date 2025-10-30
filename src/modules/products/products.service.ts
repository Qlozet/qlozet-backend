// product.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ClothingDocument,
  Discount,
  DiscountDocument,
  Product,
  ProductDocument,
  Style,
  StyleDocument,
  TaxonomyDocument,
} from './schemas';
import { CreateProductDto } from './dto';
import { Utils } from '../../common/utils/pagination';
import { CreateClothingDto } from './dto/product.dto';

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
    let total = 0;
    const clothing = dto?.clothing;
    // Add fabric variants
    if (clothing?.fabric_variants?.length) {
      const fabricSum = clothing.fabric_variants.reduce(
        (sum, f) => sum + (f.price_per_yard * f.yard_length || 0),
        0,
      );
      total += fabricSum;
    }

    // Add color variants
    if (clothing?.color_variants?.length) {
      const colorSum = clothing.color_variants.reduce(
        (sum, v) => sum + (v?.stock ? v.price * v.stock : 0),
        0,
      );
      total += colorSum;
    }

    // Add style price
    if (clothing.styles?.price) {
      total += clothing.styles.price;
    }

    return total;
  }

  private computeAccessoryPrice(dto: any): number {
    const accessory = dto?.accessory;
    let total = accessory.base_price || 0;

    if (accessory.variants?.length) {
      const variantSum = accessory.variants.reduce(
        (sum, v) => sum + (v.price || 0),
        0,
      );
      total += variantSum;
    }

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
