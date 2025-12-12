import { Length } from 'class-validator';
import {
  Injectable,
  Inject,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  Order,
  OrderDocument,
  OrderItem,
  OrderStatus,
} from './schemas/orders.schema';
import { OrderValidationService } from './orders.validation';
import { PriceCalculationService } from './orders.price-calculation';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  ClothingType,
  NormalizedSelections,
  ProcessedOrderItem,
  ProductKind,
} from './schemas/orders.interfaces';
import {
  Accessory,
  AccessoryDocument,
  DiscountDocument,
  Fabric,
  FabricDocument,
  ProductDocument,
  StyleDocument,
} from '../products/schemas';
import { ProcessedOrderItemDto } from './dto/order-item.dto';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';
import { TransactionType } from '../transactions/schema/transaction.schema';
import { Utils } from '../../common/utils/pagination';
import { AddressDocument } from '../ums/schemas/address.schema';
import {
  AccessorySelectionDto,
  FabricSelectionDto,
  OrderItemSelectionsDto,
  StyleSelectionDto,
  VariantSelectionDto,
} from './dto/selection.dto';
import { TransactionService } from '../transactions/transactions.service';
import { User } from '../ums/schemas';
import { LogisticsService } from '../logistics/logistics.service';
import { UserService } from '../ums/services';
import { ProductService } from '../products/products.service';
import { PaymentService } from '../payment/payment.service';
import { Business } from '../business/schemas/business.schema';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private readonly validationService: OrderValidationService,
    private readonly transactionService: TransactionService,
    private readonly paymentService: PaymentService,
    private readonly priceCalculationService: PriceCalculationService,
    private readonly logisticService: LogisticsService,
    @InjectModel('Product') private productModel: Model<ProductDocument>,
    @InjectModel('Style') private styleModel: Model<StyleDocument>,
    @InjectModel('Fabric') private fabricModel: Model<FabricDocument>,
    @InjectModel('Accessory') private accessoryModel: Model<AccessoryDocument>,
    @InjectModel('Discount') private discountModel: Model<DiscountDocument>,
    @InjectModel('Address') private addressModel: Model<AddressDocument>,
  ) {}

  async createOrder(orderData: CreateOrderDto, customer: User) {
    const [, shippingAddress, processedItems] = await Promise.all([
      this.validationService.validateCompleteOrder(orderData.items),
      this.resolveShippingAddress(customer.id),
      this.processOrderItems(orderData.items),
    ]);

    const [orderReference, { total, subtotal }] = await Promise.all([
      generateUniqueQlozetReference(this.orderModel, 'ORD'),
      this.priceCalculationService.calculateOrderTotal(processedItems),
    ]);

    const normalizedItems = processedItems.map((item) => {
      const selections = item.selections || {};
      return {
        product: item.product_id,
        business: item.business,
        note: item.note,
        product_kind: item.product_kind,
        clothing_type: item.clothing_type,
        color_variant_selections: selections.color_variant_selection || [],
        fabric_selections: selections.fabric_selection || [],
        style_selections: selections.style_selection || [],
        accessory_selections: selections.accessory_selection || [],
        total_price: total ?? 0,
        subtotal,
      };
    });

    const order = new this.orderModel({
      reference: orderReference,
      customer: new Types.ObjectId(customer.id),
      address: shippingAddress,
      items: normalizedItems,
      status: 'pending',
      subtotal,
      shipping_fee: 0,
      total,
    });
    const savedOrder = await order.save();

    const transaction = await this.transactionService.create({
      initiator: new Types.ObjectId(customer.id),
      order: savedOrder.id,
      type: TransactionType.DEBIT,
      amount: savedOrder.total,
      description: `Order payment for order ${savedOrder.reference}`,
      channel: 'checkout',
      metadata: {
        order_reference: savedOrder.reference,
        items_count: savedOrder.items.length,
      },
    });

    const paymentInit = await this.paymentService.initializePaystackPayment(
      transaction.reference,
      customer.email,
    );

    return {
      message: 'Order created successfully. Redirect to payment.',
      data: {
        order: savedOrder,
        transaction: {
          reference: transaction.reference,
          amount: transaction.amount,
          status: transaction.status,
          metadata: transaction.metadata,
        },
        payment: paymentInit.data,
      },
    };
  }
  async getProductDetails(
    product: ProductDocument,
  ): Promise<{ name: string; description?: string }> {
    switch (product.kind) {
      case ProductKind.ACCESSORY:
        return {
          name: product.accessory?.name ?? 'Unknown Accessory',
          description: product.accessory?.description,
        };
      case ProductKind.CLOTHING:
        return {
          name: product.clothing?.name ?? 'Unknown Clothing',
          description: product.clothing?.description,
        };
      case ProductKind.FABRIC:
        return {
          name: product.fabric?.name ?? 'Unknown Fabric',
          description: product.fabric?.description,
        };
      default:
        return { name: 'Unknown Product', description: undefined };
    }
  }

  private async processOrderItems(
    items: ProcessedOrderItemDto[],
  ): Promise<ProcessedOrderItem[]> {
    return Promise.all(
      items.map(async (item) => {
        const product = await this.productModel.findById(item.product_id);
        if (!product) {
          throw new BadRequestException(
            `Product not found: ${item.product_id}`,
          );
        }
        const rawSelections = await this.normalizeSelections(
          item.selections,
          product,
        );

        const styleSelections =
          rawSelections.style_selection ?? rawSelections.style_selection ?? [];
        const fabricSelections =
          rawSelections.fabric_selection ??
          rawSelections.fabric_selection ??
          [];
        const accessorySelections =
          rawSelections.accessory_selection ??
          rawSelections.accessory_selection ??
          [];
        const colorVariantSelections =
          rawSelections.color_variant_selection ??
          rawSelections.color_variant_selection ??
          [];

        const [
          styleSnapshots,
          fabricSnapshots,
          accessoryDocs,
          discountSnapshot,
        ] = await Promise.all([
          styleSelections.length
            ? Promise.all(
                styleSelections.map((s) =>
                  this.styleModel.findById(s.style_id),
                ),
              )
            : [],
          fabricSelections.length
            ? Promise.all(
                fabricSelections.map((f) =>
                  this.fabricModel.findById(f.fabric_id),
                ),
              )
            : [],
          accessorySelections.length
            ? this.productModel
                .find({
                  _id: {
                    $in: accessorySelections.map((a) => a.accessory_id),
                  },
                })
                .exec()
            : [],
          product.applied_discount
            ? this.discountModel.findById(product.applied_discount)
            : null,
        ]);
        const { name } = await this.getProductDetails(product);
        const selections = await this.normalizeSelections(item.selections);
        const itemForPricing: ProcessedOrderItem = {
          ...item,
          product_name: name,
          business: product?.business,
          selections,
          total_price: 0,
          discount_snapshot: discountSnapshot
            ? this.sanitizeDiscountSnapshot(discountSnapshot)
            : undefined,
        };

        const totalPrice =
          await this.priceCalculationService.calculateItemTotal(itemForPricing);

        // Build the final selections shape that matches ProcessedOrderItem interface:
        const finalSelections = {
          color_variant_selection: colorVariantSelections,
          style_selection: styleSelections,
          fabric_selection: fabricSelections,
          accessory_selection: accessorySelections,
        };

        return {
          product_id: item.product_id,
          product_name: name,
          business: product?.business,
          product_kind: product.kind as ProductKind,
          clothing_type: product.clothing?.type as ClothingType,
          note: item.note,
          selections: finalSelections,
          total_price: totalPrice,
          product_snapshot: this.sanitizeProductSnapshot(product),
          style_snapshot:
            styleSnapshots && styleSnapshots.length
              ? styleSnapshots
                  .filter(Boolean)
                  .map((s) => this.sanitizeStyleSnapshot(s))
              : null,
          fabric_snapshot:
            fabricSnapshots && fabricSnapshots.length
              ? fabricSnapshots
                  .filter(Boolean)
                  .map((f) => this.sanitizeFabricSnapshot(f))
              : null,
          accessory_snapshot:
            accessoryDocs && accessoryDocs.length
              ? this.sanitizeAccessorySnapshot(accessoryDocs) // sanitizer expects array
              : null,
          discount_snapshot: discountSnapshot
            ? this.sanitizeDiscountSnapshot(discountSnapshot)
            : null,
        } as ProcessedOrderItem;
      }),
    );
  }

  private async normalizeSelections(
    selections?: OrderItemSelectionsDto,
    product?: ProductDocument,
  ): Promise<NormalizedSelections> {
    if (!selections || !product) {
      return {
        color_variant_selection: [],
        style_selection: [],
        fabric_selection: [],
        accessory_selection: [],
      };
    }

    const clothing = product.clothing;

    // --- Color Variants ---
    const normalizedColorVariants: VariantSelectionDto[] = [];
    for (const cvs of selections.color_variant_selections || []) {
      const colorVariant = clothing?.color_variants?.find((cv) =>
        cv.variants.some((v) => v._id?.equals(cvs.variant_id)),
      );
      if (!colorVariant) continue;

      const variant = colorVariant.variants.find((v) =>
        v._id?.equals(cvs.variant_id),
      );
      if (!variant) continue;

      const quantity = cvs.quantity ?? 1;
      normalizedColorVariants.push({
        variant_id: new Types.ObjectId(variant._id),
        size: variant.size,
        price: variant.price,
        quantity,
        total_amount: variant.price * quantity,
      });
    }

    // --- Styles ---
    const normalizedStyles: StyleSelectionDto[] = [];
    for (const ss of selections.style_selections || []) {
      const style = clothing?.styles?.find((s) => s._id?.equals(ss.style_id));
      if (!style) continue;

      const quantity = ss.quantity ?? 1;
      normalizedStyles.push({
        style_id: new Types.ObjectId(style._id),
        price: style.price,
        quantity,
        total_amount: style.price * quantity,
      });
    }

    // --- Fabrics ---
    const normalizedFabrics: FabricSelectionDto[] = [];
    for (const fs of selections.fabric_selections || []) {
      let fabric: Fabric | null | undefined =
        clothing?.fabrics?.find((f) => f._id?.equals(fs.fabric_id)) ??
        (await this.fabricModel.findById(fs.fabric_id));

      if (!fabric) continue;

      const quantity = (fs.quantity ?? 1) * (fs.yardage ?? 1);
      normalizedFabrics.push({
        fabric_id: new Types.ObjectId(fabric._id),
        price: fabric.price_per_yard,
        quantity,
        yardage: fs.yardage,
        total_amount: fabric.price_per_yard * quantity,
      });
    }

    // --- Accessories ---
    const normalizedAccessories: AccessorySelectionDto[] = [];
    for (const as of selections.accessory_selections || []) {
      const accessory: Accessory | undefined | null =
        clothing?.accessories?.find((a) => a._id?.equals(as.accessory_id)) ??
        (await this.accessoryModel.findById(as.accessory_id));

      if (!accessory) continue;

      const accessoryVariant = accessory.variants.find((av) =>
        av._id?.equals(as.variant_id),
      );
      if (!accessoryVariant) continue;

      const quantity = as.quantity ?? 1;
      normalizedAccessories.push({
        accessory_id: new Types.ObjectId(accessory._id),
        variant_id: new Types.ObjectId(accessoryVariant._id),
        price: accessory.price,
        quantity,
        total_amount: accessory.price * quantity,
      });
    }

    return {
      color_variant_selection: normalizedColorVariants,
      style_selection: normalizedStyles,
      fabric_selection: normalizedFabrics,
      accessory_selection: normalizedAccessories,
    };
  }

  // Helper methods to sanitize snapshots (remove sensitive data)
  private sanitizeProductSnapshot(product: any): any {
    const { __v, createdAt, updatedAt, ...sanitized } = product.toObject
      ? product.toObject()
      : product;
    return sanitized;
  }

  private sanitizeStyleSnapshot(style: any): any {
    const { __v, createdAt, updatedAt, ...sanitized } = style.toObject
      ? style.toObject()
      : style;
    return sanitized;
  }

  private sanitizeFabricSnapshot(fabric: any): any {
    const { __v, createdAt, updatedAt, ...sanitized } = fabric.toObject
      ? fabric.toObject()
      : fabric;
    return sanitized;
  }

  private sanitizeAccessorySnapshot(accessories: any[]): any[] {
    return accessories.map((accessory) => {
      const { __v, createdAt, updatedAt, ...sanitized } = accessory.toObject
        ? accessory.toObject()
        : accessory;
      return sanitized;
    });
  }
  private async resolveShippingAddress(customerId: string): Promise<any> {
    const existingAddress = await this.addressModel.findOne({
      customer: customerId,
    });

    if (!existingAddress) {
      throw new BadRequestException(
        'Address not found or does not belong to customer',
      );
    }

    return existingAddress;
  }
  private sanitizeDiscountSnapshot(discount: any): any {
    const { __v, createdAt, updatedAt, ...sanitized } = discount.toObject
      ? discount.toObject()
      : discount;
    return sanitized;
  }

  async findVendorOrders(
    page: number = 1,
    size: number = 10,
    status?: string,
    business?: Types.ObjectId,
  ) {
    try {
      const { skip, take } = await Utils.getPagination(page, size);
      const filter: any = {};
      if (business) {
        filter['items.business'] = business;
      }
      if (status && status !== 'all') {
        filter.status = status;
      }

      const [orders, total] = await Promise.all([
        this.orderModel
          .find(filter)
          .populate('customer', 'email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(take)
          .lean(),
        this.orderModel.countDocuments(filter),
      ]);
      return Utils.getPagingData(
        {
          count: total,
          rows: orders,
        },
        page,
        size,
      );
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  async findCustomerOrdersWithFilters(
    customerId: Types.ObjectId,
    page: number = 1,
    size: number = 10,
    status?: string,
  ): Promise<{
    data: OrderDocument[];
    total_items: number;
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const { skip, take } = await Utils.getPagination(page, size);

    // Build query
    const query: any = { customer: new Types.ObjectId(customerId) };
    if (status) {
      query.status = status;
    }

    const [orders, total] = await Promise.all([
      this.orderModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .populate('items.product', 'name images base_price')
        .populate('customer', 'firstName lastName email')
        .exec(),

      this.orderModel.countDocuments(query),
    ]);

    return Utils.getPagingData({ count: total, rows: orders }, page, size);
  }
  async getAdminDashboardMetrics() {
    const [totalOrders, ordersDelivered, ordersInTransit, topProducts] =
      await Promise.all([
        this.orderModel.countDocuments(), // total orders
        this.orderModel.countDocuments({ status: OrderStatus.COMPLETED }), // delivered
        this.orderModel.countDocuments({ status: OrderStatus.PROCESSING }), // in transit
        this.orderModel.aggregate([
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.product',
              totalOrdered: {
                $sum: {
                  $sum: [
                    '$items.variant_selections.quantity',
                    '$items.fabric_selections.quantity',
                    '$items.accessory_selections.quantity',
                  ],
                },
              },
            },
          },
          { $sort: { totalOrdered: -1 } },
          { $limit: 5 }, // top 5 must-purchase products
          {
            $lookup: {
              from: 'products',
              localField: '_id',
              foreignField: '_id',
              as: 'product',
            },
          },
          { $unwind: '$product' },
          {
            $project: {
              _id: 0,
              product_id: '$_id',
              name: '$product.name',
              totalOrdered: 1,
            },
          },
        ]),
      ]);

    return {
      total_orders: totalOrders,
      orders_delivered: ordersDelivered,
      orders_in_transit: ordersInTransit,
      must_purchase_products: topProducts,
    };
  }
  async getVendorDashboardMetrics(businessId: Types.ObjectId) {
    const [totalOrders, ordersDelivered, ordersInTransit, topProducts] =
      await Promise.all([
        this.orderModel.countDocuments({ 'items.business': businessId }), // total orders for this business
        this.orderModel.countDocuments({
          'items.business': businessId,
          status: OrderStatus.COMPLETED,
        }), // delivered
        this.orderModel.countDocuments({
          'items.business': businessId,
          status: 'processing',
        }), // in transit
        this.orderModel.aggregate([
          { $unwind: '$items' },
          { $match: { 'items.business': businessId } },
          {
            $group: {
              _id: '$items.product',
              totalOrdered: {
                $sum: {
                  $sum: [
                    '$items.variant_selections.quantity',
                    '$items.fabric_selections.quantity',
                    '$items.accessory_selections.quantity',
                  ],
                },
              },
            },
          },
          { $sort: { totalOrdered: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: 'products',
              localField: '_id',
              foreignField: '_id',
              as: 'product',
            },
          },
          { $unwind: '$product' },
          {
            $project: {
              _id: 0,
              product_id: '$_id',
              name: '$product.name',
              totalOrdered: 1,
            },
          },
        ]),
      ]);

    return {
      total_orders: totalOrders,
      orders_delivered: ordersDelivered,
      orders_in_transit: ordersInTransit,
      must_purchase_products: topProducts,
    };
  }

  async cancelOrder(reference: string) {
    const orderReference =
      await this.transactionService.refundPaystackPayment(reference);

    const updateResult = await this.orderModel.updateOne(
      { reference: orderReference },
      { $set: { status: OrderStatus.CANCELLED } },
    );

    return {
      message: 'Order cancelled and refunded successfully',
      data: updateResult,
    };
  }

  async confirmOrder(orderReference: string, business: Business) {
    const order = await this.orderModel.findOne({ reference: orderReference });
    if (!order) throw new BadRequestException('Order not found');

    const shippingAddress = order.address;
    if (!shippingAddress || !shippingAddress.address_code) {
      throw new BadRequestException(
        'Shipping address not found or address_code missing',
      );
    }

    if (!business.address_code) {
      throw new BadRequestException('Business address_code is missing');
    }
    const transaction =
      await this.transactionService.findByReference(orderReference);
    if (!transaction || transaction.status !== 'success') {
      throw new BadRequestException(
        'Cannot confirm order: payment not completed',
      );
    }

    const now = new Date();
    const pickupDate = now.toISOString().split('T')[0]; // yyyy-mm-dd

    const shippingItems = await Promise.all(
      order.items.map(async (item) => {
        const product = await this.productModel.findById(item.product).lean();
        if (!product) throw new BadRequestException();
        const { name, description } = await this.getProductDetails(product);
        return {
          name,
          description: description ?? name,
          unit_weight: 1,
          unit_amount: order.total,
          quantity: 1,
        };
      }),
    );

    const data = {
      sender_address_code: shippingAddress.address_code,
      reciever_address_code: business.address_code,
      pickup_date: pickupDate,
      package_items: shippingItems,
      service_type: 'pickup',
      package_dimension: { length: 12, width: 10, height: 10 },
    };
    await this.logisticService.createShipment(data);
    order.status = OrderStatus.PROCESSING;
    await order.save();

    return {
      message: 'Order confirmed and shipment created successfully',
      data: order,
    };
  }
}
