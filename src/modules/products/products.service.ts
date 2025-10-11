// product.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { Style, StyleDocument } from './schemas/style.schema';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { CreateStyleDto } from './dto/style.dto';
import { FabricDto } from './dto/fabric.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Style.name) private styleModel: Model<StyleDocument>,
  ) {}

  async createProduct(
    createProductDto: CreateProductDto,
    vendor: string,
  ): Promise<{ data: ProductDocument; message: string }> {
    // Validate kind-specific requirements first
    this.validateProductKind(createProductDto);

    // Calculate base_price from variants based on product kind
    const calculatedBasePrice = this.calculateBasePrice(createProductDto);

    // Use the calculated price instead of the provided one
    const productData = {
      ...createProductDto,
      base_price: calculatedBasePrice,
      vendor,
    };

    const product = new this.productModel(productData);
    await product.save();

    const productObject = product.toObject();

    return {
      data: productObject,
      message: 'Product created successfully',
    };
  }

  private validateFabricData(fabrics: FabricDto): void {
    if (!fabrics) {
      throw new BadRequestException(
        'Fabric data is required for fabric products',
      );
    }
    const requiredFields = [
      'name',
      'productType',
      'yardLength',
      'width',
      'minCut',
      'pricePerYard',
    ];
    for (const field of requiredFields) {
      if (!fabrics[field]) {
        throw new BadRequestException(`Fabric ${field} is required`);
      }
    }

    if (!fabrics.variants || fabrics.variants.length === 0) {
      throw new BadRequestException('Fabric must have at least one variant');
    }
    const fabricBaseCost = fabrics.pricePerYard * fabrics.yardLength;

    fabrics.variants.forEach((variant, index) => {
      if (variant.price < fabricBaseCost) {
        throw new BadRequestException(
          `Variant ${index} price (${variant.price}) cannot be lower than fabric base cost (${fabricBaseCost})`,
        );
      }
    });
  }

  private calculateFabricBasePrice(fabrics: FabricDto): number {
    if (!fabrics?.variants || fabrics.variants.length === 0) {
      throw new BadRequestException('Fabric must have at least one variant');
    }
    const variantPrices = fabrics.variants.map((v) => v.price);
    const minPrice = Math.min(...variantPrices);
    const fabricBaseCost = fabrics.pricePerYard * fabrics.yardLength;
    return Math.max(minPrice, fabricBaseCost);
  }

  private calculateBasePrice(createProductDto: CreateProductDto): number {
    const { kind, fabrics, styles, accessories, base_price } = createProductDto;

    switch (kind) {
      case 'fabric':
        if (fabrics) {
          return this.calculateFabricBasePrice(fabrics);
        }
        break;

      case 'clothing':
        if (styles?.variants && styles?.variants?.length > 0) {
          return Math.min(...styles.variants.map((v) => v.price));
        }
        break;

      case 'accessory':
        if (accessories?.variants && accessories?.variants?.length > 0) {
          return Math.min(...accessories.variants.map((v) => v.price));
        }
        break;
    }
    return base_price || 0;
  }
  async getProductById(
    id: string,
  ): Promise<{ data: ProductDocument; message: string }> {
    const product = await this.productModel
      .findById(id)
      .populate('vendor')
      .populate('taxonomy')
      .exec();

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return {
      data: product,
      message: 'Product retrieved successfully',
    };
  }

  async getProducts(query: any = {}) {
    const { page = 1, limit = 10, kind, status, vendor, ...filters } = query;
    const skip = (page - 1) * limit;

    const dbQuery: any = { ...filters };
    if (kind) dbQuery.kind = kind;
    if (status) dbQuery.status = status;
    if (vendor) dbQuery.vendor = new Types.ObjectId(vendor);

    const [products, total] = await Promise.all([
      this.productModel
        .find(dbQuery)
        .populate('vendor')
        .populate('taxonomy')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.productModel.countDocuments(dbQuery).exec(),
    ]);

    return { data: products };
  }

  async updateProduct(
    id: string,
    updateProductDto: UpdateProductDto,
  ): Promise<ProductDocument> {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const kind = updateProductDto?.kind;
    // Prevent changing product kind
    if ((kind as any) && kind !== product.kind) {
      throw new BadRequestException(
        'Cannot change product kind after creation',
      );
    }

    const updatedProduct = await this.productModel
      .findByIdAndUpdate(id, updateProductDto, { new: true })
      .populate('vendor')
      .populate('taxonomy')
      .exec();

    if (!updatedProduct) {
      throw new NotFoundException(
        `Product with ID ${id} not found after update`,
      );
    }

    return updatedProduct;
  }

  async deleteProduct(id: string): Promise<void> {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    await this.productModel.findByIdAndUpdate(
      id,
      { status: 'archived' },
      { new: true },
    );
  }

  async updateInventory(
    productId: string,
    variantUpdates: Array<{
      variantIndex: number;
      stock: number;
    }>,
  ): Promise<ProductDocument> {
    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    // Update inventory based on product kind
    let hasChanges = false;

    if (product.kind === 'fabric' && product.fabrics) {
      variantUpdates.forEach((update) => {
        if (product.fabrics?.variants[update.variantIndex]) {
          product.fabrics.variants[update.variantIndex].stock = update.stock;
          hasChanges = true;
        }
      });
      if (hasChanges) product.markModified('fabrics.variants');
    } else if (product.kind === 'accessory' && product.accessories) {
      variantUpdates.forEach((update) => {
        if (product.accessories?.variants[update.variantIndex]) {
          product.accessories.variants[update.variantIndex].stock =
            update.stock;
          hasChanges = true;
        }
      });
      if (hasChanges) product.markModified('accessories.variants');
    } else if (product.kind === 'clothing' && product.styles) {
      variantUpdates.forEach((update) => {
        if (product.styles?.variants[update.variantIndex]) {
          product.styles.variants[update.variantIndex].stock = update.stock;
          hasChanges = true;
        }
      });
      if (hasChanges) product.markModified('styles.variants');
    }

    if (hasChanges) {
      return await product.save();
    }

    return product;
  }

  // Style Management
  async createStyle(createStyleDto: CreateStyleDto): Promise<StyleDocument> {
    const style = new this.styleModel(createStyleDto);
    return await style.save();
  }

  async getAllStyles(): Promise<StyleDocument[]> {
    return await this.styleModel.find().sort({ createdAt: -1 }).exec();
  }

  // Private methods
  private validateProductKind(createProductDto: CreateProductDto): void {
    const { kind, fabrics, styles, accessories, is_customizable } =
      createProductDto;

    switch (kind) {
      case 'fabric':
        if (!fabrics) {
          throw new BadRequestException(
            'Fabric data is required for fabric products',
          );
        }
        this.validateFabricData(fabrics);
        break;
      case 'clothing':
        if (is_customizable && !styles) {
          throw new BadRequestException(
            'Style data is required when clothing is customizable',
          );
        }
        break;
      case 'accessory':
        if (!accessories) {
          throw new BadRequestException(
            'Accessory data is required for accessory products',
          );
        }
        break;
    }
  }
}
