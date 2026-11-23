import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from './schemas/orders.schema';
import { Product, ProductDocument } from '../products/schemas';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { CartService } from '../cart/cart.service';
import { OrderService } from './orders.service';
import { isCustomerVisible } from '../products/customer-visibility';
import { BOUGHT_ORDER_FILTER, ReorderSkip, reorderLinesFrom } from './order-again';

const LIVE_STORE_STATUSES = ['approved', 'verified'];

/**
 * Order again (put a past order's pieces back in the cart) and Your tailors
 * (the stores a customer has bought from). Rules in ./order-again.ts.
 */
@Injectable()
export class OrderAgainService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(Business.name) private readonly businessModel: Model<BusinessDocument>,
    private readonly cartService: CartService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Adds an order's pieces (or one of them) to the customer's cart at
   * today's prices. Pieces that can't be bought any more are left out and
   * listed with the reason, so the customer is never surprised at checkout.
   */
  async reorder(reference: string, customerId: string, itemId?: string) {
    const order: any = await this.orderModel
      .findOne({ reference: String(reference), customer: new Types.ObjectId(customerId) })
      .lean();
    if (!order) throw new NotFoundException('Order not found');
    if (order.payment_status !== 'paid') {
      throw new BadRequestException('Only a paid order can be ordered again.');
    }

    const { lines, skipped } = reorderLinesFrom(order, itemId);
    if (itemId && !lines.length && !skipped.length) {
      throw new NotFoundException('That item is not on this order.');
    }

    const products: any[] = lines.length
      ? await this.productModel
          .find({ _id: { $in: lines.map((l) => new Types.ObjectId(l.productId)) } })
          .lean()
      : [];
    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const nameOf = (p: any) =>
      p?.clothing?.name ?? p?.accessory?.name ?? p?.fabric?.name ?? null;

    const added: { item_id: string; product_id: string; name: string | null }[] = [];
    const left: (ReorderSkip & { name?: string | null })[] = [...skipped];

    for (const line of lines) {
      const product = productMap.get(line.productId);
      if (!product || product.deleted_at || !isCustomerVisible(product)) {
        left.push({
          item_id: line.item_id,
          product_id: line.productId,
          name: nameOf(product),
          reason: 'No longer for sale.',
        });
        continue;
      }
      const stock = this.orderService.cartAvailabilityIssues(
        [{ product_id: line.productId, selections: line.selections, quantity: line.quantity }],
        productMap,
      );
      if (stock.length) {
        left.push({
          item_id: line.item_id,
          product_id: line.productId,
          name: nameOf(product),
          reason: stock[0].reason,
        });
        continue;
      }
      try {
        await this.cartService.addItem(
          customerId,
          line.productId,
          line.quantity,
          line.appliedFabricId,
          line.appliedFabricYards,
          line.note,
          line.selections as any,
          line.appliedFabricSize,
          {
            lineKey: line.lineKey,
            size: line.size,
            color: line.color,
            measurementSet: line.measurementSet,
          },
        );
        added.push({ item_id: line.item_id, product_id: line.productId, name: nameOf(product) });
      } catch (e: any) {
        left.push({
          item_id: line.item_id,
          product_id: line.productId,
          name: nameOf(product),
          reason: e?.message || 'Could not be added.',
        });
      }
    }

    const cart = await this.cartService.getCart(customerId);
    const message = !added.length
      ? 'Nothing from this order could be added to your cart.'
      : left.length
        ? `Added ${added.length} to your cart. ${left.length} could not be added.`
        : `Added ${added.length} to your cart at today's prices.`;
    return { message, data: { added, skipped: left, cart } };
  }

  /**
   * The stores this customer has bought from, most recent first: the
   * "Your tailors" shelf. Only stores still selling are shown.
   */
  async makers(customerId: string, limit = 12) {
    const size = Math.min(Math.max(Number(limit) || 12, 1), 30);
    const rows: any[] = await this.orderModel.aggregate([
      { $match: { customer: new Types.ObjectId(customerId), ...BOUGHT_ORDER_FILTER } },
      { $unwind: '$items' },
      { $match: { 'items.business': { $ne: null }, 'items.rejected': { $ne: true } } },
      {
        $group: {
          _id: { $toObjectId: '$items.business' },
          orders: { $addToSet: '$_id' },
          last_ordered_at: { $max: '$createdAt' },
          bespoke: { $max: { $cond: [{ $eq: ['$type', 'bespoke'] }, 1, 0] } },
          made_to_measure: {
            $max: { $cond: [{ $eq: ['$items.clothing_type', 'customize'] }, 1, 0] },
          },
        },
      },
      { $sort: { last_ordered_at: -1 } },
      { $limit: 60 },
      {
        $lookup: {
          from: this.businessModel.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'business',
        },
      },
      { $unwind: '$business' },
      {
        $match: {
          'business.status': { $in: LIVE_STORE_STATUSES },
          'business.is_active': { $ne: false },
        },
      },
      { $limit: size },
    ]);

    // The latest order from each store, for "Order again" on the shelf.
    const latest: any[] = rows.length
      ? await this.orderModel.aggregate([
          { $match: { customer: new Types.ObjectId(customerId), ...BOUGHT_ORDER_FILTER } },
          { $sort: { createdAt: -1 } },
          { $unwind: '$items' },
          {
            $match: {
              'items.business': { $in: rows.flatMap((r) => [r._id, String(r._id)]) },
            },
          },
          {
            $group: {
              _id: { $toString: '$items.business' },
              reference: { $first: '$reference' },
              type: { $first: '$type' },
              // Newest order with a listing in it (bespoke has none to reorder).
              listing_refs: {
                $push: { $cond: [{ $ne: ['$items.product', null] }, '$reference', '$$REMOVE'] },
              },
            },
          },
        ])
      : [];
    const latestBy = new Map(latest.map((l) => [String(l._id), l]));

    const data = rows.map((r) => {
      const b = r.business;
      const last = latestBy.get(String(r._id));
      return {
        business_id: String(r._id),
        business_name: b.business_name,
        slug: b.slug ?? null,
        business_logo_url: b.business_logo_url ?? null,
        verified: b.status === 'verified',
        accepts_bespoke: !!b.accepts_bespoke,
        orders_count: r.orders.length,
        last_ordered_at: r.last_ordered_at,
        made_to_measure: !!r.made_to_measure,
        bespoke: !!r.bespoke,
        // Order again only makes sense for a listing; a bespoke order is
        // made again by asking the tailor for a new quote.
        last_order_reference: last?.reference ?? null,
        last_order_type: last?.type ?? null,
        reorder_reference: last?.listing_refs?.[0] ?? null,
      };
    });
    return { message: 'Stores you have ordered from', data };
  }
}
