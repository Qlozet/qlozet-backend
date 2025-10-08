import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product } from './schemas/product.schema';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
  ) {}

  async createProduct(
    dto: CreateProductDto,
    vendorId: string,
  ): Promise<Product> {
    const existing = await this.productModel.findOne({
      name: dto.name.trim(),
      vendorId,
    });

    if (existing) {
      throw new ConflictException(
        `A product with the name ${dto.name} already exists.`,
      );
    }

    try {
      const createdProduct = new this.productModel({
        ...dto,
        vendorId,
        variants: dto.variants || [],
        customizations: dto.customizations || [],
      });

      return await createdProduct.save();
    } catch (error) {
      if (error instanceof ConflictException) throw error;

      throw new InternalServerErrorException(
        'An error occurred while creating the product.',
      );
    }
  }

  async updateProduct(
    id: string,
    updateData: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.productModel.findById(id);
    if (!product) throw new NotFoundException('Product not found');

    Object.keys(updateData).forEach((key) => {
      if (key !== 'customizations') {
        product[key] = updateData[key];
      }
    });

    if (updateData.customizations !== undefined) {
      product.customizations = updateData.customizations;
      product.markModified('customizations');
    }

    return product.save();
  }

  async findAll(): Promise<Product[]> {
    return this.productModel.find().populate('vendorId').exec();
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productModel
      .findById(id)
      .populate('vendorId')
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async deleteProduct(id: string): Promise<void> {
    await this.productModel.findByIdAndDelete(id);
  }
}
