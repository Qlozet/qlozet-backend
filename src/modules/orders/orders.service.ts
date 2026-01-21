import { Length } from 'class-validator';
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  ALLOWED_STATUSES,
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
import { PaymentService } from '../payment/payment.service';
import { Business } from '../business/schemas/business.schema';
import { BusinessEarningDocument } from '../business/schemas/business-earnings.schema';
import { EventsService } from '../recommendations/events/events.service';
import { EventType } from '../recommendations/events/enums/event-type.enum';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

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
    @InjectModel('BusinessEarning')
    private businessEarningsModel: Model<BusinessEarningDocument>,
    private readonly eventsService: EventsService,
  ) { }

  async createOrder(orderData: CreateOrderDto, customer: User) {
    try {
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

      // Hook: Log Purchase Event Server-Side
      try {
        const context = {
          surface: 'server_hook',
          requestId: savedOrder.reference,
        };
        // Fire and forget - don't block response
        processedItems.forEach(item => {
          this.eventsService.logEvent({
            userId: customer.id,
            eventType: EventType.PURCHASE,
            timestamp: new Date(),
            properties: {
              itemId: item.product_id.toString(),
              businessId: item.business?.toString(),
              price: item.total_price,
              quantity: 1, // Normalized items might not store quantity flatly if variants differ, assuming 1 for now or check selections
              // If item.selections has quantities, we should sum them? 
              // Simplified: Just log the item purchase.
            },
            context,
            metadata: {
              reasonCodes: ['ORDER_CREATED']
            }
          } as any).catch(err => this.logger.warn(`Failed to log purchase event: ${err.message}`));
        });
      } catch (e) {
        this.logger.warn('Event hook failed', e);
      }

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
      console.log(transaction, 'transaction');
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
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger?.error('Create order failed', error.stack || error);

      throw new InternalServerErrorException(
        'Unable to create order at this time. Please try again.',
      );
    }
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
    const accessory = product.accessory;
    const fabric = product.fabric;

    // --- Color Variants ---
    const normalizedColorVariants: VariantSelectionDto[] = [];
    for (const cvs of selections.color_variant_selections || []) {
      const colorVariant = clothing?.color_variants?.find((cv) =>
        cv.variants.some((v) => v._id?.equals(cvs.color_variant_id)),
      );
      if (!colorVariant) continue;

      const variant = colorVariant.variants.find((v) =>
        v._id?.equals(cvs.color_variant_id),
      );
      if (!variant) continue;

      const quantity = cvs.quantity ?? 1;
      normalizedColorVariants.push({
        color_variant_id: new Types.ObjectId(variant._id),
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
      let isFabricExist =
        clothing?.fabrics?.find((f) => f._id?.equals(fs.fabric_id)) ?? fabric;

      if (!isFabricExist) continue;

      const quantity = (fs.quantity ?? 1) * (fs.yardage ?? 1);
      normalizedFabrics.push({
        fabric_id: new Types.ObjectId(isFabricExist._id),
        price: isFabricExist.price_per_yard,
        quantity,
        yardage: fs.yardage,
        total_amount: isFabricExist.price_per_yard * quantity,
      });
    }

    // --- Accessories ---
    const normalizedAccessories: AccessorySelectionDto[] = [];
    for (const as of selections.accessory_selections || []) {
      console.log('Accessory selection accessory_id:', accessory?._id);
      console.log(
        'Clothing accessory IDs:',
        clothing?.accessories?.map((a) => a._id?.toString()),
      );
      const isAccessoryExist =
        clothing?.accessories?.find((a) => a._id?.equals(as.accessory_id)) ??
        accessory;

      if (!isAccessoryExist) continue;

      const accessoryVariant = isAccessoryExist.variants.find((av) =>
        av._id?.equals(as.variant_id),
      );
      if (!accessoryVariant) continue;

      const quantity = as.quantity ?? 1;
      normalizedAccessories.push({
        accessory_id: new Types.ObjectId(isAccessoryExist._id),
        variant_id: new Types.ObjectId(accessoryVariant._id),
        price: isAccessoryExist.price,
        quantity,
        total_amount: isAccessoryExist.price * quantity,
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
        const product = await this.productModel.findById(item.product);
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

  async getChart(): Promise<any> {
    const [ordersByGender, ordersByLocation, ordersByProduct] =
      await Promise.all([
        this.getOrdersByGenderChart(),
        this.getOrdersByLocationChart(),
        this.getOrdersByProductChart(),
      ]);

    return {
      charts: {
        ordersByGender: ordersByGender.data,
        ordersByLocation: ordersByLocation.data,
        ordersByProduct: ordersByProduct.data,
      },
    };
  }

  async getOrdersByGenderChart(): Promise<any> {
    const data = await this.orderModel.aggregate([
      {
        // Join with the users collection to get customer details
        $lookup: {
          from: 'users', // MongoDB collection name
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      { $unwind: '$customer_info' }, // Flatten the array
      {
        $group: {
          _id: '$customer_info.gender', // Group by gender
          count: { $sum: 1 }, // Count orders per gender
        },
      },
    ]);

    // Transform to chart JSON format
    const chartData = {
      data: {
        chartType: 'pie',
        title: 'Orders by Gender',
        series: [
          {
            key: 'gender',
            name: 'Gender Distribution',
            data: data.map((d) => ({
              label: d._id || 'Unknown',
              value: d.count,
              color: d._id === 'Male' ? '#3d2817' : '#d4c5b9',
            })),
          },
        ],
      },
    };

    return chartData;
  }
  async getOrdersByLocationChart(): Promise<any> {
    const data = await this.orderModel.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      { $unwind: '$customer_info' },
      {
        $group: {
          _id: {
            location: '$customer_info.address.city',
            gender: '$customer_info.gender',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Extract unique locations
    const locations = Array.from(
      new Set(data.map((d) => d._id.location || d._id.gender || 'Unknown')),
    );

    // Helper to generate series
    const generateSeries = (gender: string, color: string) => ({
      key: gender.toLowerCase(),
      name: gender,
      color,
      data: locations.map((loc) => {
        const record = data.find(
          (d) => d._id.location === loc && d._id.gender === gender,
        );
        return { label: loc, value: record ? record.count : 0 };
      }),
    });

    // Ensure both Male and Female series exist, even if no orders
    const maleSeries = generateSeries('Male', '#3d2817');
    const femaleSeries = generateSeries('Female', '#9C8578');

    return {
      data: {
        chartType: 'stacked_bar',
        title: 'Orders by Location',
        series: [maleSeries, femaleSeries],
      },
    };
  }
  async getOrdersByProductChart(): Promise<any> {
    const data = await this.orderModel.aggregate([
      // Join with users to get gender
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      { $unwind: '$customer_info' },

      // Unwind each order's items
      { $unwind: '$items' },

      // Join with products to get product name
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product_info',
        },
      },
      { $unwind: '$product_info' },

      // Group by product name and gender
      {
        $group: {
          _id: {
            product: '$product_info.clothing.name', // or use .fabric.name/.accessory.name depending on product type
            gender: '$customer_info.gender',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Extract unique product names
    const products = Array.from(
      new Set(data.map((d) => d._id.product || 'Unknown')),
    );

    // Prepare male and female series
    const maleSeries = {
      key: 'male',
      name: 'Male',
      color: '#3d2817',
      data: products.map((prod) => {
        const record = data.find(
          (d) => d._id.product === prod && d._id.gender === 'Male',
        );
        return { label: prod, value: record ? record.count : 0 };
      }),
    };

    const femaleSeries = {
      key: 'female',
      name: 'Female',
      color: '#9C8578',
      data: products.map((prod) => {
        const record = data.find(
          (d) => d._id.product === prod && d._id.gender === 'Female',
        );
        return { label: prod, value: record ? record.count : 0 };
      }),
    };

    return {
      data: {
        chartType: 'stacked_bar',
        title: 'Orders by Product',
        series: [maleSeries, femaleSeries],
      },
    };
  }
  async getBusinessChart(businessId: string): Promise<any> {
    const businessObjectId = new Types.ObjectId(businessId);

    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 7);

    const previousStart = new Date(now);
    previousStart.setDate(now.getDate() - 14);

    const previousEnd = new Date(now);
    previousEnd.setDate(now.getDate() - 7);

    const [ordersByGender, ordersByLocation, ordersByProduct] =
      await Promise.all([
        this.getBusinessOrdersByGenderChart(businessId),
        this.getBusinessOrdersByLocationChart(businessId),
        this.getBusinessOrdersByProductChart(businessId),
      ]);

    /* ===================== ORDERS STATS (SINGLE QUERY) ===================== */
    const ordersAgg = await this.orderModel.aggregate([
      { $unwind: '$items' },
      {
        $match: {
          'items.business': businessObjectId,
          status: { $in: [...ALLOWED_STATUSES, OrderStatus.RETURNED] },
        },
      },
      {
        $facet: {
          current: [
            { $match: { createdAt: { $gte: currentStart } } },
            {
              $group: {
                _id: '$_id',
                createdAt: { $first: '$createdAt' },
                status: { $first: '$status' },
              },
            },
          ],
          previous: [
            {
              $match: {
                createdAt: { $gte: previousStart, $lt: previousEnd },
              },
            },
            {
              $group: {
                _id: '$_id',
                createdAt: { $first: '$createdAt' },
                status: { $first: '$status' },
              },
            },
          ],
        },
      },
    ]);

    const stats = ordersAgg[0] || {};
    const currentOrders = stats.current || [];
    const previousOrders = stats.previous || [];

    const totalOrders = currentOrders.length;
    const previousTotalOrders = previousOrders.length;

    const totalReturns = currentOrders.filter(
      (o) => o.status === OrderStatus.RETURNED,
    ).length;

    const previousReturns = previousOrders.filter(
      (o) => o.status === OrderStatus.RETURNED,
    ).length;

    const calcAvgPerDay = (orders: any[]) => {
      if (!orders.length) return 0;

      const days = new Set(
        orders.map((o) => o.createdAt.toISOString().slice(0, 10)),
      );

      return Math.round(orders.length / days.size);
    };

    const averageOrdersPerDay = calcAvgPerDay(currentOrders);
    const previousAverageOrdersPerDay = calcAvgPerDay(previousOrders);

    /* ===================== EARNINGS STATS (SINGLE QUERY) ===================== */
    const earningsAgg = await this.businessEarningsModel.aggregate([
      {
        $match: {
          business: businessObjectId,
        },
      },
      {
        $facet: {
          current: [
            { $match: { createdAt: { $gte: currentStart } } },
            {
              $group: {
                _id: null,
                total: { $sum: '$net_amount' },
              },
            },
          ],
          previous: [
            {
              $match: {
                createdAt: { $gte: previousStart, $lt: previousEnd },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$net_amount' },
              },
            },
          ],
        },
      },
    ]);

    const totalEarnings = earningsAgg[0]?.current[0]?.total || 0;
    const previousEarnings = earningsAgg[0]?.previous[0]?.total || 0;

    /* ===================== PERCENTAGE HELPER ===================== */
    const percentChange = (current: number, previous: number) => {
      if (previous === 0 && current === 0) return '0%';
      if (previous === 0) return '+100%';

      const value = ((current - previous) / previous) * 100;
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    };

    /* ===================== SUMMARY ===================== */
    const summary = {
      totalOrders,
      totalOrdersChange: percentChange(totalOrders, previousTotalOrders),
      totalEarnings,
      totalEarningsChange: percentChange(totalEarnings, previousEarnings),
      averageOrdersPerDay,
      averageOrdersChange: percentChange(
        averageOrdersPerDay,
        previousAverageOrdersPerDay,
      ),
      totalReturns,
      totalReturnsChange: percentChange(totalReturns, previousReturns),
    };

    return {
      summary,
      charts: {
        ordersByGender: ordersByGender.data,
        ordersByLocation: ordersByLocation.data,
        ordersByProduct: ordersByProduct.data,
      },
    };
  }

  async getBusinessOrdersByGenderChart(businessId: string): Promise<any> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' }, // Unwind items to check business
      { $match: { 'items.business': new Types.ObjectId(businessId) } }, // filter by business
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      { $unwind: '$customer_info' },
      {
        $group: {
          _id: '$customer_info.gender',
          count: { $sum: 1 },
        },
      },
    ]);

    return {
      data: {
        chartType: 'pie',
        title: 'Orders by Gender',
        series: [
          {
            key: 'gender',
            name: 'Gender Distribution',
            data: data.map((d) => ({
              label: d._id || 'Unknown',
              value: d.count,
              color: d._id === 'Male' ? '#3d2817' : '#d4c5b9',
            })),
          },
        ],
      },
    };
  }

  async getBusinessOrdersByLocationChart(businessId: string): Promise<any> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.business': new Types.ObjectId(businessId) } },
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      { $unwind: '$customer_info' },
      {
        $group: {
          _id: {
            location: '$customer_info.address.city',
            gender: '$customer_info.gender',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const locations = Array.from(
      new Set(data.map((d) => d._id.location || d._id.gender || 'Unknown')),
    );

    const generateSeries = (gender: string, color: string) => ({
      key: gender.toLowerCase(),
      name: gender,
      color,
      data: locations.map((loc) => {
        const record = data.find(
          (d) => d._id.location === loc && d._id.gender === gender,
        );
        return { label: loc, value: record ? record.count : 0 };
      }),
    });

    return {
      data: {
        chartType: 'stacked_bar',
        title: 'Orders by Location',
        series: [
          generateSeries('Male', '#3d2817'),
          generateSeries('Female', '#9C8578'),
        ],
      },
    };
  }

  async getBusinessOrdersByProductChart(businessId: string): Promise<any> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.business': new Types.ObjectId(businessId) } },
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      { $unwind: '$customer_info' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product_info',
        },
      },
      { $unwind: '$product_info' },
      {
        $group: {
          _id: {
            product: '$product_info.clothing.name',
            gender: '$customer_info.gender',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const products = Array.from(
      new Set(data.map((d) => d._id.product || 'Unknown')),
    );

    const maleSeries = {
      key: 'male',
      name: 'Male',
      color: '#3d2817',
      data: products.map((prod) => {
        const record = data.find(
          (d) => d._id.product === prod && d._id.gender === 'Male',
        );
        return { label: prod, value: record ? record.count : 0 };
      }),
    };

    const femaleSeries = {
      key: 'female',
      name: 'Female',
      color: '#9C8578',
      data: products.map((prod) => {
        const record = data.find(
          (d) => d._id.product === prod && d._id.gender === 'Female',
        );
        return { label: prod, value: record ? record.count : 0 };
      }),
    };

    return {
      data: {
        chartType: 'stacked_bar',
        title: 'Orders by Product',
        series: [maleSeries, femaleSeries],
      },
    };
  }
}
