import { Injectable, NotFoundException } from '@nestjs/common';
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
  ): Promise<CartDocument> {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    const unitPrice = product.base_price;
    const totalPrice = unitPrice * quantity;

    const cart = await this.getCart(userId);
    const existingItem = cart.items.find(
      (i) => i.product_id.toString() === productId.toString(),
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.total_price =
        existingItem.quantity * existingItem.unit_price;
    } else {
      cart.items.push({
        product_id: new Types.ObjectId(productId),
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
      (i) => i.product_id.toString() !== productId.toString(),
    );
    this.calculateTotals(cart);
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
