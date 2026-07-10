import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schema/cart.schema';
import { Product, ProductDocument } from '../products/schemas';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async getCart(userId: string): Promise<CartDocument> {
    let cart = await this.cartModel
      .findOne({ user: userId })
      .populate('items.product_id');
    if (!cart) {
      cart = await this.cartModel.create({ user: userId, items: [] });
    }
    return cart;
  }

  async addItem(
    userId: string,
    productId: string,
    quantity = 1,
    appliedFabricId?: string,
    appliedFabricYards?: number,
  ): Promise<CartDocument> {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    let unitPrice = product.base_price;

    // If an external fabric is applied, validate and add its cost
    let fabricObjectId: Types.ObjectId | undefined;
    if (appliedFabricId && appliedFabricYards) {
      const fabricProduct = await this.productModel.findById(appliedFabricId);
      if (!fabricProduct || fabricProduct.kind !== 'fabric') {
        throw new NotFoundException('Applied fabric product not found');
      }
      if (!fabricProduct.fabric) {
        throw new NotFoundException('Fabric data is missing from this product');
      }
      if (appliedFabricYards < fabricProduct.fabric.min_cut) {
        throw new BadRequestException(
          `Minimum yardage is ${fabricProduct.fabric.min_cut} for this fabric`,
        );
      }
      const fabricCost =
        fabricProduct.fabric.price_per_yard * appliedFabricYards;
      unitPrice += fabricCost;
      fabricObjectId = new Types.ObjectId(appliedFabricId);
    }

    const totalPrice = unitPrice * quantity;

    const cart = await this.getCart(userId);
    const existingItem = cart.items.find(
      (i) => (i.product_id as any)?._id?.toString() === productId.toString() || i.product_id.toString() === productId.toString(),
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.total_price =
        existingItem.quantity * existingItem.unit_price;
    } else {
      cart.items.push({
        product_id: new Types.ObjectId(productId),
        applied_fabric_id: fabricObjectId || undefined,
        applied_fabric_yards: appliedFabricYards || undefined,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
      });
    }

    this.calculateTotals(cart);
    await cart.save();
    return cart;
  }

  async removeItem(userId: string, productId: string): Promise<CartDocument> {
    const cart = await this.getCart(userId);
    cart.items = cart.items.filter(
      (i) => {
        const itemId = (i.product_id as any)?._id?.toString() || i.product_id.toString();
        return itemId !== productId.toString();
      }
    ) as any;
    this.calculateTotals(cart);
    cart.markModified('items');
    await cart.save();
    return cart;
  }

  private calculateTotals(cart: CartDocument) {
    cart.subtotal = cart.items.reduce((sum, i) => sum + i.total_price, 0);
  }

  async clearCart(userId: string) {
    await this.cartModel.updateOne(
      { user: userId },
      { $set: { items: [], subtotal: 0, total: 0 } },
    );
  }
}
