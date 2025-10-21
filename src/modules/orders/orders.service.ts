import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CartService } from '../cart/cart.service';
import {
  Discount,
  DiscountDocument,
  Product,
  ProductDocument,
} from '../products/schemas';
import { Order, OrderDocument } from './schemas/orders.schema';
import { TransactionService } from '../transactions/transactions.service';
import { generateUniqueQlozetReference } from 'src/common/utils/generateString';
import { TransactionType } from '../transactions/schema/transaction.schema';

@Injectable()
export class OrderService {
  constructor(
    private readonly cartService: CartService,
    private readonly transactionService: TransactionService,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Discount.name)
    private readonly discountModel: Model<DiscountDocument>,
  ) {}
  async createDirectOrder(
    userId: string,
    productId: string,
    quantity: number,
    dto: any,
  ): Promise<OrderDocument> {
    const product = await this.productModel.findById(productId).populate({
      path: 'applied_discount',
      model: 'Discount',
      match: { is_active: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    let finalPrice = product.discounted_price || product.base_price;

    const discount = product.applied_discount as any;
    if (discount && discount.is_active) {
      const now = new Date();
      if (
        (!discount.start_date || new Date(discount.start_date) <= now) &&
        (!discount.end_date || new Date(discount.end_date) >= now)
      ) {
        if (
          ['fixed', 'flash_fixed', 'category_specific'].includes(discount.type)
        ) {
          finalPrice = Math.max(finalPrice - discount.value, 0);
        } else if (
          ['percentage', 'flash_percentage', 'store_wide'].includes(
            discount.type,
          )
        ) {
          finalPrice = Math.max(
            finalPrice - (finalPrice * discount.value) / 100,
            0,
          );
        }
      }
    }

    const subtotal = finalPrice * quantity;
    const shipping_fee = dto.shipping_fee ?? 0;
    const total = subtotal + shipping_fee;

    const reference = await generateUniqueQlozetReference(
      this.orderModel,
      'ORD',
    );

    const order = new this.orderModel({
      reference,
      customer: userId,
      items: [
        {
          product_id: product._id,
          quantity,
          unit_price: finalPrice,
          total_price: subtotal,
        },
      ],
      addresses: dto.addresses,
      subtotal,
      shipping_fee,
      total,
      payment_method: dto.payment_method ?? 'card',
    });

    await order.save();

    await this.transactionService.create({
      initiator: userId,
      business: dto.businessId,
      wallet: dto?.walletId,
      amount: order.total,
      description: 'Order payment',
      type: TransactionType.DEBIT,
    });

    return order;
  }

  async createOrderFromCart(userId: string, dto: any): Promise<OrderDocument> {
    const cart = await this.cartService.getCart(userId);
    if (!cart.items.length) throw new BadRequestException('Cart is empty');

    const productIds = cart.items.map((i) => i.product_id);
    const products = await this.productModel
      .find({ _id: { $in: productIds } })
      .populate({
        path: 'applied_discount',
        model: 'Discount',
        match: { is_active: true },
      });

    let subtotal = 0;

    for (const item of cart.items) {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) continue;

      let finalPrice = product.discounted_price || product.base_price;

      const discount = product.applied_discount as any;
      if (discount && discount.is_active) {
        const now = new Date();
        if (
          (!discount.start_date || new Date(discount.start_date) <= now) &&
          (!discount.end_date || new Date(discount.end_date) >= now)
        ) {
          if (
            ['fixed', 'flash_fixed', 'category_specific'].includes(
              discount.type,
            )
          ) {
            finalPrice = Math.max(finalPrice - discount.value, 0);
          } else if (
            ['percentage', 'flash_percentage', 'store_wide'].includes(
              discount.type,
            )
          ) {
            finalPrice = Math.max(
              finalPrice - (finalPrice * discount.value) / 100,
              0,
            );
          }
        }
      }

      item.unit_price = finalPrice;
      item.total_price = finalPrice * item.quantity;
      subtotal += item.total_price;
    }

    const shipping_fee = dto.shipping_fee ?? 0;
    const total = subtotal + shipping_fee;

    const reference = await generateUniqueQlozetReference(
      this.orderModel,
      'ORD',
    );

    const order = new this.orderModel({
      reference,
      customer: userId,
      items: cart.items,
      addresses: dto.addresses,
      subtotal,
      shipping_fee,
      total,
      payment_method: dto.payment_method ?? 'card',
    });

    await order.save();

    await this.transactionService.create({
      initiator: userId,
      business: dto.businessId,
      wallet: dto?.walletId,
      amount: order.total,
      description: 'Order payment',
      type: TransactionType.DEBIT,
    });

    await this.cartService.clearCart(userId);

    return order;
  }
}
