import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schema/cart.schema';
import { Product, ProductDocument } from '../products/schemas';
import { EventsService } from '../recommendations/events/events.service';
import { EventType } from '../recommendations/events/enums/event-type.enum';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly eventsService: EventsService,
  ) { }

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

    // Hook: Add To Cart
    this.eventsService.logEvent({
      userId,
      eventType: EventType.ADD_TO_CART,
      timestamp: new Date(),
      properties: {
        itemId: productId,
        businessId: product.business?.toString(),
        price: unitPrice,
        quantity
      },
      context: { surface: 'server_hook' }
    } as any).catch(e => this.logger.warn('Failed cart hook', e));

    return cart;
  }

  async removeItem(userId: string, productId: string): Promise<CartDocument> {
    const cart = await this.getCart(userId);
    cart.items = cart.items.filter(
      (i) => i.product_id.toString() !== productId.toString(),
    );
    this.calculateTotals(cart);
    await cart.save();

    // Hook: Remove From Cart
    this.eventsService.logEvent({
      userId,
      eventType: EventType.REMOVE_FROM_CART,
      timestamp: new Date(),
      properties: { itemId: productId },
      context: { surface: 'server_hook' }
    } as any).catch(e => this.logger.warn('Failed cart remove hook', e));

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
