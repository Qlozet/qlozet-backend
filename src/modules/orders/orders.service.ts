import { Length } from 'class-validator';
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  HttpException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  ALLOWED_STATUSES,
  Order,
  OrderDocument,
  OrderItem,
  OrderStatus,
  ShipmentStatus,
  ShipmentType,
  VendorShipment,
} from './schemas/orders.schema';
import { OrderValidationService } from './orders.validation';
import { PriceCalculationService } from './orders.price-calculation';
import { CreateOrderDto, PaymentMethod } from './dto/create-order.dto';
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
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { BusinessEarningDocument } from '../business/schemas/business-earnings.schema';
import {
  CheckoutPreviewResponse,
  CheckoutPreviewDto,
  VendorShippingRate,
  FabricTransferRate,
} from './dto/checkout-preview.dto';
import { FulfillOrderDto } from './dto/fulfill-order.dto';
import { Cart, CartDocument } from '../cart/schema/cart.schema';
import {
  CheckoutRateCache,
  CheckoutRateCacheDocument,
} from './schemas/checkout-rate-cache.schema';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService, CreateNotificationDto } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

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
    @InjectModel('Business') private businessModel: Model<BusinessDocument>,
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(CheckoutRateCache.name)
    private rateCacheModel: Model<CheckoutRateCacheDocument>,
    @InjectModel('User') private userModel: Model<User>,
    @Inject(forwardRef(() => WalletsService))
    private readonly walletsService: WalletsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createOrder(orderData: CreateOrderDto, customer: User) {
    try {
      const [, shippingAddress, processedItems, fullCustomer] = await Promise.all([
        this.validationService.validateCompleteOrder(orderData.items),
        this.resolveShippingAddress(customer.id, orderData.address_id),
        this.processOrderItems(orderData.items),
        this.userModel.findById(customer.id).lean(),
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

      // Build VendorShipment entries if shipping selections are provided
      const shipments: any[] = [];
      let totalShippingFee = 0;

      if (orderData.selected_shipping?.length) {
        // Group processed items by business_id
        const itemsByBusiness = new Map<string, any[]>();
        for (const item of processedItems) {
          const bizId = item.business?.toString();
          if (!bizId) continue;
          if (!itemsByBusiness.has(bizId)) {
            itemsByBusiness.set(bizId, []);
          }
          itemsByBusiness.get(bizId)!.push(item);
        }

        for (const selection of orderData.selected_shipping) {
          // Look up the cached rate from checkout-preview instead of trusting the frontend
          const cachedEntry = await this.rateCacheModel.findOne({
            customer: new Types.ObjectId(customer.id),
            request_token: selection.request_token,
            business_id: selection.business_id,
          });

          if (!cachedEntry) {
            throw new BadRequestException(
              `Shipping quote expired for vendor ${selection.business_id}. Please re-run checkout preview.`,
            );
          }

          const matchedRate = cachedEntry.rates.find(
            (r) => r.courier_id === selection.courier_id && r.service_code === selection.service_code,
          );

          if (!matchedRate) {
            throw new BadRequestException(
              `Selected courier ${selection.courier_id} not found in cached rates. Please re-run checkout preview.`,
            );
          }

          // Use the server-side cached rate, not the frontend's value
          const verifiedShippingFee = matchedRate.rate_amount;

          shipments.push({
            business: new Types.ObjectId(selection.business_id),
            request_token: selection.request_token,
            service_code: selection.service_code,
            courier_id: selection.courier_id,
            courier_name: matchedRate.courier_name || selection.courier_name,
            shipping_fee: verifiedShippingFee,
            status: 'pending',
            rate_fetched_at: cachedEntry.createdAt,
          });
          totalShippingFee += verifiedShippingFee;
        }
      }

      // ── Build fabric transfer shipments (Fabric Vendor → Tailor) ──
      if (orderData.selected_fabric_transfers?.length) {
        for (const transfer of orderData.selected_fabric_transfers) {
          // Validate against cached rates (same pattern as normal shipping)
          const cachedEntry = await this.rateCacheModel.findOne({
            customer: new Types.ObjectId(customer.id),
            request_token: transfer.request_token,
            business_id: transfer.fabric_vendor_id,
          });

          if (!cachedEntry) {
            throw new BadRequestException(
              `Fabric transfer shipping quote expired for vendor ${transfer.fabric_vendor_id}. Please re-run checkout preview.`,
            );
          }

          const matchedRate = cachedEntry.rates.find(
            (r) => r.courier_id === transfer.courier_id && r.service_code === transfer.service_code,
          );

          if (!matchedRate) {
            throw new BadRequestException(
              `Selected courier ${transfer.courier_id} not found in cached fabric transfer rates. Please re-run checkout preview.`,
            );
          }

          const verifiedTransferFee = matchedRate.rate_amount;

          shipments.push({
            business: new Types.ObjectId(transfer.fabric_vendor_id),
            destination_business: new Types.ObjectId(transfer.tailor_vendor_id),
            shipment_type: ShipmentType.FABRIC_TRANSFER,
            fabric_product: new Types.ObjectId(transfer.fabric_product_id),
            fabric_yards: transfer.fabric_yards,
            request_token: transfer.request_token,
            service_code: transfer.service_code,
            courier_id: transfer.courier_id,
            courier_name: transfer.courier_name,
            shipping_fee: verifiedTransferFee,
            status: 'pending',
            rate_fetched_at: cachedEntry.createdAt,
          });
          totalShippingFee += verifiedTransferFee;
        }
      }

      const finalTotal = total + totalShippingFee;

      // Check if any item is bespoke/customize to attach body profile
      const isBespoke = processedItems.some(
        (item) => item.clothing_type === ClothingType.CUSTOMIZE,
      );

      let customer_body_profile: {
        body_type: string;
        confidence: string;
        measurements: Record<string, number>;
        unit: string;
        fit_preferences: string[];
      } | undefined = undefined;
      if (isBespoke && fullCustomer?.body_type_classification && fullCustomer?.measurementSets?.length) {
        const activeSet = fullCustomer.measurementSets.find((s) => s.active);
        if (activeSet) {
          customer_body_profile = {
            body_type: fullCustomer.body_type_classification.bodyType,
            confidence: fullCustomer.body_type_classification.confidence,
            measurements: activeSet.measurements,
            unit: activeSet.unit,
            fit_preferences: fullCustomer.body_fit || [],
          };
        }
      }

      const order = new this.orderModel({
        reference: orderReference,
        customer: new Types.ObjectId(customer.id),
        address: shippingAddress,
        items: normalizedItems,
        status: 'pending',
        subtotal,
        shipping_fee: totalShippingFee,
        total: finalTotal,
        shipments,
        customer_body_profile,
      });

      const savedOrder = await order.save();

      // ==================== PAYMENT BRANCHING ====================
      const paymentMethod = orderData.payment_method || PaymentMethod.PAYSTACK;

      if (paymentMethod === PaymentMethod.WALLET) {
        // --- WALLET PAYMENT ---
        const wallet = await this.walletsService.getOrCreateWallet({ customer: customer.id });

        if (wallet.balance < savedOrder.total) {
          // Clean up: delete the order since payment can't proceed
          await this.orderModel.deleteOne({ _id: savedOrder._id });
          throw new BadRequestException(
            `Insufficient wallet balance. You have ₦${wallet.balance.toLocaleString()} but the order total is ₦${savedOrder.total.toLocaleString()}.`,
          );
        }

        // Debit wallet
        await this.walletsService.debitWallet(wallet._id.toString(), savedOrder.total);

        // Create transaction record
        const transaction = await this.transactionService.create({
          initiator: new Types.ObjectId(customer.id),
          order: savedOrder.id,
          wallet: wallet._id,
          type: TransactionType.DEBIT,
          amount: savedOrder.total,
          description: `Wallet payment for order ${savedOrder.reference}`,
          channel: 'wallet_checkout',
          metadata: {
            order_reference: savedOrder.reference,
            items_count: savedOrder.items.length,
            payment_method: 'wallet',
          },
        });

        // Mark transaction as success immediately (wallet already debited)
        transaction.status = 'success' as any;
        await transaction.save();

        // Mark order as processing (payment is complete)
        savedOrder.status = OrderStatus.PROCESSING;
        await savedOrder.save();

        // Notify vendor(s) about new order
        this.notifyVendorsNewOrder(savedOrder, customer).catch((err) =>
          this.logger.error('Failed to send new order notifications', err),
        );

        // Notify vendors about fabric transfers (if any)
        this.notifyFabricTransfers(savedOrder).catch((err) =>
          this.logger.error('Failed to send fabric transfer notifications', err),
        );

        return {
          message: 'Order created and paid via wallet successfully.',
          data: {
            order: savedOrder,
            transaction: {
              reference: transaction.reference,
              amount: transaction.amount,
              status: transaction.status,
              metadata: transaction.metadata,
            },
            payment: {
              method: 'wallet',
              paid: true,
              wallet_balance_after: wallet.balance - savedOrder.total,
            },
          },
        };
      } else {
        // --- PAYSTACK PAYMENT (default) ---
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
            payment_method: 'paystack',
          },
        });

        const paymentInit = await this.paymentService.initializePaystackPayment(
          transaction.reference,
          customer.email,
        );

        // Notify vendor(s) about new order
        this.notifyVendorsNewOrder(savedOrder, customer).catch((err) =>
          this.logger.error('Failed to send new order notifications', err),
        );

        // Notify vendors about fabric transfers (if any)
        this.notifyFabricTransfers(savedOrder).catch((err) =>
          this.logger.error('Failed to send fabric transfer notifications', err),
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
    } catch (error: any) {
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

      // Auto-resolve yardage from yard_per_order if not explicitly provided
      let yardage = fs.yardage;
      if (!yardage && fs.size && isFabricExist.variants?.length) {
        const matchingVariant = isFabricExist.variants.find(
          (v) => v.size?.toLowerCase() === fs.size!.toLowerCase(),
        );
        if (matchingVariant?.yard_per_order) {
          yardage = matchingVariant.yard_per_order;
        }
      }
      if (!yardage) yardage = 1; // fallback

      const quantity = (fs.quantity ?? 1) * yardage;
      normalizedFabrics.push({
        fabric_id: new Types.ObjectId(isFabricExist._id),
        price: isFabricExist.price_per_yard,
        quantity,
        yardage,
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
  private async resolveShippingAddress(
    customerId: string,
    addressId?: string,
  ): Promise<any> {
    let address;
    if (addressId) {
      address = await this.addressModel.findOne({
        _id: addressId,
        customer: customerId,
      });
      if (!address) {
        throw new BadRequestException(
          'Specified address not found or does not belong to customer',
        );
      }
    } else {
      // Try default, then fallback to any
      address = await this.addressModel.findOne({
        customer: customerId,
        is_default: true,
      });
      if (!address) {
        address = await this.addressModel.findOne({ customer: customerId });
      }
    }

    if (!address) {
      throw new BadRequestException(
        'Please add a shipping address before placing an order',
      );
    }

    return address;
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
          .populate('shipments.business', 'business_name business_logo_url')
          .populate('shipments.destination_business', 'business_name business_logo_url')
          .populate('shipments.fabric_product', 'fabric.name base_price')
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

    // Notify vendor(s) about cancellation
    const order = await this.orderModel.findOne({ reference: orderReference });
    if (order) {
      this.notifyVendorsOrderCancelled(order).catch((err) =>
        this.logger.error('Failed to send cancellation notifications', err),
      );
    }

    return {
      message: 'Order cancelled and refunded successfully',
      data: updateResult,
    };
  }

  /**
   * @deprecated Replaced by fulfillVendorShipment()
   */
  async confirmOrder(orderReference: string, business: Business) {
    return this.fulfillVendorShipment(orderReference, business, {});
  }

  /**
   * Checkout preview: split cart by vendor, fetch rates per vendor.
   * Returns per-vendor courier options for the customer to select.
   */
  async checkoutPreview(
    customer: any,
    dto: CheckoutPreviewDto,
  ): Promise<CheckoutPreviewResponse> {
    // 1. Get customer address (by ID or default)
    const customerId = customer.id || customer._id;
    let customerAddress;
    if (dto.address_id) {
      customerAddress = await this.addressModel.findOne({
        _id: dto.address_id,
        customer: customerId,
      });
      if (!customerAddress) {
        throw new BadRequestException('Specified address not found');
      }
    } else {
      customerAddress = await this.addressModel.findOne({
        customer: customerId,
        is_default: true,
      });
      if (!customerAddress) {
        // Fallback to any address
        customerAddress = await this.addressModel.findOne({ customer: customerId });
      }
    }
    if (!customerAddress?.address_code) {
      throw new BadRequestException(
        'Please add and validate a shipping address before checkout',
      );
    }

    // 2. Get cart
    const cart = await this.cartModel
      .findOne({ user: customer.id || customer._id })
      .populate('items.product_id');
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // 3. Get all products with business info
    const productIds = cart.items.map((i) => i.product_id);
    const products = await this.productModel
      .find({ _id: { $in: productIds } });

    // 4. Group items by business_id — batch lookup businesses
    const bizIds = [...new Set(
      products
        .map((p) => p.business?.toString())
        .filter(Boolean) as string[],
    )];
    const businesses = await this.businessModel.find({
      _id: { $in: bizIds },
    });
    const bizMap = new Map(
      businesses.map((b) => [String(b._id), b]),
    );

    const vendorGroups = new Map<
      string,
      {
        business: BusinessDocument;
        items: Array<{ product_id: string; product_name: string; amount: number; weight: number }>;
      }
    >();

    for (const product of products) {
      const bizId = product.business?.toString();
      if (!bizId || !bizMap.has(bizId)) continue;

      if (!vendorGroups.has(bizId)) {
        vendorGroups.set(bizId, { business: bizMap.get(bizId)!, items: [] });
      }

      const { name } = await this.getProductDetails(product);
      vendorGroups.get(bizId)!.items.push({
        product_id: String(product._id),
        product_name: name,
        amount: product.base_price || 0,
        weight: 1, // default weight in kg
      });
    }

    // 5. Fetch rates per vendor — PARALLEL
    const pickupDate = new Date().toISOString().split('T')[0];
    const _debug: any[] = [];

    const ratePromises = Array.from(vendorGroups.entries())
      .filter(([, group]) => {
        if (!group.business.address_code) {
          this.logger.warn(
            `Vendor ${group.business.business_name} has no validated address`,
          );
          _debug.push({ vendor: group.business.business_name, reason: 'no_address_code' });
          return false;
        }
        return true;
      })
      .map(async ([bizId, group]) => {
        const biz = group.business;
        try {
          const ratePayload = {
            sender_address_code: biz.address_code!,
            reciever_address_code: customerAddress.address_code!,
            pickup_date: pickupDate,
            package_items: group.items.map((item) => ({
              name: item.product_name,
              description: item.product_name,
              unit_weight: item.weight,
              unit_amount: item.amount,
              quantity: 1,
            })),
            service_type: dto.service_type || 'pickup',
            category_id: 74794423, // "Fashion wears"
            package_dimension: { length: 12, width: 10, height: 10 },
          };

          const rateResponse = await this.logisticService.fetchRates(
            [],
            ratePayload,
          );

          const rates = (rateResponse.couriers || []).map((c) => ({
            courier_id: String(c.courier_id),
            courier_name: c.courier_name,
            courier_image: c.courier_image,
            service_code: c.service_code,
            rate_amount: c.total,
            delivery_eta: c.delivery_eta,
            delivery_eta_time: c.delivery_eta_time,
            insurance_fee: c.insurance?.fee || 0,
            insurance_code: c.insurance?.code || '',
          }));

          return {
            business_id: bizId,
            business_name: biz.business_name,
            items: group.items.map((i) => ({
              product_id: i.product_id,
              product_name: i.product_name,
            })),
            request_token: rateResponse.request_token,
            rates,
            cheapest_rate: rateResponse.cheapest_courier?.total || 0,
            fastest_rate: rateResponse.fastest_courier?.total || 0,
          } as VendorShippingRate;
        } catch (error) {
          this.logger.error(
            `Failed to fetch rates for vendor ${biz.business_name}: ${error.message}`,
          );
          _debug.push({
            vendor: biz.business_name,
            reason: 'rate_fetch_failed',
            error: error.message || String(error),
            sender_address_code: biz.address_code,
            receiver_address_code: customerAddress.address_code,
          });
          return null;
        }
      });

    const results = await Promise.allSettled(ratePromises);
    const vendorShipping: VendorShippingRate[] = results
      .filter(
        (r): r is PromiseFulfilledResult<VendorShippingRate | null> =>
          r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value!);

    // ── 5b. Detect cross-vendor fabric transfers ──────────────────
    const fabricTransfers: FabricTransferRate[] = [];

    for (const cartItem of cart.items) {
      if (!cartItem.applied_fabric_id) continue;

      const fabricId = (cartItem.applied_fabric_id as any)?._id?.toString()
        || cartItem.applied_fabric_id.toString();
      const clothingId = (cartItem.product_id as any)?._id?.toString()
        || cartItem.product_id.toString();

      const clothingProduct = products.find((p) => String(p._id) === clothingId);
      const fabricProduct = await this.productModel.findById(fabricId);

      if (!clothingProduct || !fabricProduct) continue;

      const clothingBizId = clothingProduct.business?.toString();
      const fabricBizId = fabricProduct.business?.toString();

      // Same vendor → no transfer needed
      if (!clothingBizId || !fabricBizId || clothingBizId === fabricBizId) continue;

      const fabricBiz = bizMap.get(fabricBizId)
        || await this.businessModel.findById(fabricBizId);
      const tailorBiz = bizMap.get(clothingBizId)
        || await this.businessModel.findById(clothingBizId);

      if (!fabricBiz || !tailorBiz) continue;

      if (!fabricBiz.address_code || !tailorBiz.address_code) {
        this.logger.warn(
          `Cannot quote fabric transfer: missing address code for ${fabricBiz.business_name} or ${tailorBiz.business_name}`,
        );
        continue;
      }

      // Get fabric name
      const fabricName = fabricProduct.fabric?.name || 'Fabric';
      const fabricYards = cartItem.applied_fabric_yards || 1;

      try {
        const transferPayload = {
          sender_address_code: fabricBiz.address_code,
          reciever_address_code: tailorBiz.address_code,
          pickup_date: pickupDate,
          package_items: [{
            name: fabricName,
            description: `${fabricYards} yards of ${fabricName}`,
            unit_weight: Math.ceil(fabricYards * 0.3), // ~0.3kg per yard
            unit_amount: fabricProduct.base_price || 0,
            quantity: 1,
          }],
          service_type: dto.service_type || 'pickup',
          category_id: 74794423, // "Fashion wears"
          package_dimension: { length: 30, width: 20, height: 5 }, // Fabric roll dimensions
        };

        const transferRateResponse = await this.logisticService.fetchRates([], transferPayload);

        const transferRates = (transferRateResponse.couriers || []).map((c) => ({
          courier_id: String(c.courier_id),
          courier_name: c.courier_name,
          courier_image: c.courier_image,
          service_code: c.service_code,
          rate_amount: c.total,
          delivery_eta: c.delivery_eta,
          delivery_eta_time: c.delivery_eta_time,
          insurance_fee: c.insurance?.fee || 0,
          insurance_code: c.insurance?.code || '',
        }));

        fabricTransfers.push({
          fabric_vendor_id: fabricBizId,
          fabric_vendor_name: fabricBiz.business_name,
          tailor_vendor_id: clothingBizId,
          tailor_vendor_name: tailorBiz.business_name,
          fabric_product_id: fabricId,
          fabric_name: fabricName,
          fabric_yards: fabricYards,
          request_token: transferRateResponse.request_token,
          rates: transferRates,
          cheapest_rate: transferRateResponse.cheapest_courier?.total || 0,
          fastest_rate: transferRateResponse.fastest_courier?.total || 0,
        });
      } catch (error) {
        this.logger.error(
          `Failed to fetch fabric transfer rates (${fabricBiz.business_name} → ${tailorBiz.business_name}): ${error.message}`,
        );
      }
    }

    // 6. Calculate totals (include fabric transfer fees)
    const vendorShippingFee = vendorShipping.reduce(
      (sum, vs) => sum + vs.cheapest_rate,
      0,
    );
    const fabricTransferFee = fabricTransfers.reduce(
      (sum, ft) => sum + ft.cheapest_rate,
      0,
    );
    const totalShippingFee = vendorShippingFee + fabricTransferFee;
    const subtotal = cart.subtotal || 0;

    // Cache the rates in MongoDB for server-side validation during order creation
    const allCacheEntries: any[] = [];

    if (vendorShipping.length > 0) {
      const customerId = customer.id || customer._id;
      allCacheEntries.push(
        ...vendorShipping.map((vs) => ({
          customer: new Types.ObjectId(customerId),
          request_token: vs.request_token,
          business_id: vs.business_id,
          rates: vs.rates.map((r) => ({
            courier_id: r.courier_id,
            service_code: r.service_code,
            courier_name: r.courier_name,
            rate_amount: r.rate_amount,
          })),
        })),
      );
    }

    // Also cache fabric transfer rates
    if (fabricTransfers.length > 0) {
      const customerId = customer.id || customer._id;
      allCacheEntries.push(
        ...fabricTransfers.map((ft) => ({
          customer: new Types.ObjectId(customerId),
          request_token: ft.request_token,
          business_id: ft.fabric_vendor_id,
          rates: ft.rates.map((r) => ({
            courier_id: r.courier_id,
            service_code: r.service_code,
            courier_name: r.courier_name,
            rate_amount: r.rate_amount,
          })),
        })),
      );
    }

    if (allCacheEntries.length > 0) {
      // Fire-and-forget: don't block the response on cache writes
      this.rateCacheModel.insertMany(allCacheEntries).catch((err) => {
        this.logger.warn(`Failed to cache checkout rates: ${err.message}`);
      });
    }

    return {
      vendor_shipping: vendorShipping,
      fabric_transfers: fabricTransfers,
      total_shipping_fee: totalShippingFee,
      subtotal,
      total: subtotal + totalShippingFee,
    };
  }

  /**
   * Vendor fulfills their portion of the order — creates Shipbubble label.
   * Re-fetches rates if the token is stale (> 25 minutes old).
   */
  async fulfillVendorShipment(
    orderReference: string,
    business: Business | BusinessDocument,
    dto: FulfillOrderDto,
  ) {
    const businessId = (business._id || business.id).toString();

    // Atomic claim: set status to 'ready_to_ship' only if currently 'pending'
    // This prevents double-fulfillment from concurrent requests
    const claimed = await this.orderModel.findOneAndUpdate(
      {
        reference: orderReference,
        'shipments.business': businessId,
        'shipments.status': { $in: [ShipmentStatus.PENDING, ShipmentStatus.READY_TO_SHIP] },
      },
      {
        $set: { 'shipments.$.status': ShipmentStatus.READY_TO_SHIP },
      },
      { new: true },
    );

    if (!claimed) {
      // Either order doesn't exist, no shipment for this vendor, or already fulfilled
      const order = await this.orderModel.findOne({ reference: orderReference });
      if (!order) throw new BadRequestException('Order not found');

      const existingShipment = order.shipments.find(
        (s) => s.business.toString() === businessId,
      );
      if (!existingShipment) {
        throw new BadRequestException(
          'No shipment found for your business in this order',
        );
      }
      throw new BadRequestException(
        `Shipment already ${existingShipment.status}, cannot fulfill again`,
      );
    }

    const order = claimed;

    // ── Fabric transfer gating: block tailor until fabric arrives ──
    // If this is a vendor_to_customer shipment, check if any fabric_transfer
    // shipments are destined for this vendor and haven't been delivered yet.
    const thisShipment = order.shipments.find(
      (s) => s.business.toString() === businessId,
    );
    if (thisShipment?.shipment_type !== ShipmentType.FABRIC_TRANSFER) {
      const pendingFabricTransfers = order.shipments.filter(
        (s) =>
          s.shipment_type === ShipmentType.FABRIC_TRANSFER &&
          s.destination_business?.toString() === businessId &&
          s.status !== ShipmentStatus.DELIVERED,
      );

      if (pendingFabricTransfers.length > 0) {
        // Find the fabric vendor name for a helpful error message
        const fabricVendorIds = pendingFabricTransfers.map((s) => s.business.toString());
        const fabricVendors = await this.businessModel.find({
          _id: { $in: fabricVendorIds },
        });
        const vendorNames = fabricVendors
          .map((v) => v.business_name)
          .join(', ');

        throw new BadRequestException(
          `Cannot fulfill: waiting for fabric delivery from ${vendorNames}. ` +
          `Fabric must be marked as delivered before you can ship the finished garment.`,
        );
      }
    }

    // Find the shipment for this vendor
    const shipmentIndex = order.shipments.findIndex(
      (s) => s.business.toString() === businessId,
    );
    const shipment = order.shipments[shipmentIndex];

    // Verify payment
    const transaction =
      await this.transactionService.findByReference(orderReference);
    if (!transaction || transaction.status !== 'success') {
      throw new BadRequestException(
        'Cannot fulfill order: payment not completed',
      );
    }

    // Check if rate token is stale (> 25 min)
    let requestToken = shipment.request_token;
    let courierId = dto.courier_id || shipment.courier_id;
    let serviceCode = dto.service_code || shipment.service_code;

    const RATE_TOKEN_MAX_AGE_MS = 25 * 60 * 1000; // 25 minutes
    const tokenAge = shipment.rate_fetched_at
      ? Date.now() - new Date(shipment.rate_fetched_at).getTime()
      : Infinity;

    if (tokenAge > RATE_TOKEN_MAX_AGE_MS) {
      this.logger.log(
        `Rate token for shipment is stale (${Math.round(tokenAge / 60000)}min old), re-fetching...`,
      );

      const customerAddress = order.address;
      if (!customerAddress?.address_code || !business.address_code) {
        throw new BadRequestException(
          'Cannot re-fetch rates: missing address codes',
        );
      }

      // Build items for this vendor only
      const vendorItems = order.items.filter(
        (i) => i.business?.toString() === businessId,
      );
      const shippingItems = await Promise.all(
        vendorItems.map(async (item) => {
          const product = await this.productModel.findById(item.product);
          const { name } = product
            ? await this.getProductDetails(product)
            : { name: 'Unknown' };
          return {
            name,
            description: name,
            unit_weight: 1,
            unit_amount: shipment.shipping_fee || 1000,
            quantity: 1,
          };
        }),
      );

      const rateResponse = await this.logisticService.fetchRates([], {
        sender_address_code: business.address_code,
        reciever_address_code: customerAddress.address_code,
        pickup_date: new Date().toISOString().split('T')[0],
        package_items: shippingItems,
        service_type: 'pickup',
        category_id: 74794423, // "Fashion wears"
        package_dimension: { length: 12, width: 10, height: 10 },
      });

      requestToken = rateResponse.request_token;
      // Try to use the same courier, fall back to cheapest
      const matchedCourier = rateResponse.couriers?.find(
        (c) => String(c.courier_id) === courierId,
      );
      if (matchedCourier) {
        courierId = String(matchedCourier.courier_id);
        serviceCode = matchedCourier.service_code;
      } else {
        courierId = String(rateResponse.cheapest_courier.courier_id);
        serviceCode = rateResponse.cheapest_courier.service_code;
      }

      // Update stored values
      order.shipments[shipmentIndex].request_token = requestToken;
      order.shipments[shipmentIndex].courier_id = courierId;
      order.shipments[shipmentIndex].service_code = serviceCode;
      order.shipments[shipmentIndex].rate_fetched_at = new Date();
    }

    if (!requestToken || !courierId || !serviceCode) {
      throw new BadRequestException(
        'Missing shipping data (request_token, courier_id, or service_code) for this shipment',
      );
    }

    // Create shipment label
    const shipmentResult =
      await this.logisticService.createShipmentFromToken({
        request_token: requestToken,
        courier_id: courierId,
        service_code: serviceCode,
      });

    // Update shipment data
    order.shipments[shipmentIndex].shipment_id = shipmentResult.shipment_id;
    order.shipments[shipmentIndex].tracking_number =
      shipmentResult.tracking_number;
    order.shipments[shipmentIndex].label_url = shipmentResult.label_url;
    order.shipments[shipmentIndex].status = ShipmentStatus.SHIPPED;
    order.shipments[shipmentIndex].shipped_at = new Date();

    // Check if all shipments are now shipped
    const allShipped = order.shipments.every(
      (s, i) =>
        i === shipmentIndex ||
        s.status === ShipmentStatus.SHIPPED ||
        s.status === ShipmentStatus.IN_TRANSIT ||
        s.status === ShipmentStatus.DELIVERED,
    );
    if (allShipped) {
      order.status = OrderStatus.PROCESSING;
    }

    await order.save();

    return {
      message: 'Shipment created successfully',
      data: {
        shipment: order.shipments[shipmentIndex],
        label_url: shipmentResult.label_url,
        tracking_number: shipmentResult.tracking_number,
        order_status: order.status,
      },
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

    const [ordersByGender, ordersByLocation, ordersByProduct, ordersByProductKind, orderCountByDay] =
      await Promise.all([
        this.getBusinessOrdersByGenderChart(businessId),
        this.getBusinessOrdersByLocationChart(businessId),
        this.getBusinessOrdersByProductChart(businessId),
        this.getBusinessOrdersByProductKindChart(businessId),
        this.getBusinessOrderCountByDayChart(businessId),
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
        ordersByProductKind: ordersByProductKind.data,
        orderCountByDay: orderCountByDay.data,
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

  /**
   * Orders by Product Kind — groups orders into Accessory, Custom, Fabric, Non-Custom
   */
  async getBusinessOrdersByProductKindChart(businessId: string): Promise<any> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.business': new Types.ObjectId(businessId) } },
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
        $addFields: {
          product_category: {
            $switch: {
              branches: [
                { case: { $eq: ['$product_info.kind', 'accessory'] }, then: 'Accessory' },
                { case: { $eq: ['$product_info.kind', 'fabric'] }, then: 'Fabric' },
                {
                  case: {
                    $and: [
                      { $eq: ['$product_info.kind', 'clothing'] },
                      { $eq: ['$product_info.clothing.type', 'customize'] },
                    ],
                  },
                  then: 'Custom',
                },
                {
                  case: {
                    $and: [
                      { $eq: ['$product_info.kind', 'clothing'] },
                      { $eq: ['$product_info.clothing.type', 'non_customize'] },
                    ],
                  },
                  then: 'Non-Custom',
                },
              ],
              default: 'Other',
            },
          },
        },
      },
      {
        $group: {
          _id: '$product_category',
          count: { $sum: 1 },
        },
      },
    ]);

    return {
      data: {
        chartType: 'pie',
        title: 'Orders by Product Kind',
        series: [
          {
            key: 'product_kind',
            name: 'Product Kind Distribution',
            data: data.map((d) => ({
              label: d._id || 'Unknown',
              value: d.count,
            })),
          },
        ],
      },
    };
  }

  /**
   * Order Count by Day of Week — counts orders grouped by weekday (Sun–Sat)
   */
  async getBusinessOrderCountByDayChart(businessId: string): Promise<any> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.business': new Types.ObjectId(businessId) } },
      {
        $group: {
          _id: '$_id',
          createdAt: { $first: '$createdAt' },
        },
      },
      {
        $project: {
          dayOfWeek: { $dayOfWeek: '$createdAt' }, // 1=Sun, 2=Mon, ... 7=Sat
        },
      },
      {
        $group: {
          _id: '$dayOfWeek',
          count: { $sum: 1 },
        },
      },
    ]);

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ordersByDay = dayLabels.map((label, index) => {
      const record = data.find((d) => d._id === index + 1);
      return { label, value: record ? record.count : 0 };
    });

    return {
      data: {
        chartType: 'bar',
        title: 'Order Count',
        series: [
          {
            key: 'order_count',
            name: 'Order Count',
            color: '#c4b5a0',
            data: ordersByDay,
          },
        ],
      },
    };
  }

  // ==================== NOTIFICATION HELPERS ====================

  /**
   * Notify all vendors in an order that a new order was placed.
   * Finds the vendor user (owner) for each business via User.business reference.
   */
  private async notifyVendorsNewOrder(order: OrderDocument, customer: User) {
    const businessIds = [
      ...new Set(
        order.items
          .map((item: any) => item.business?.toString())
          .filter(Boolean),
      ),
    ];

    if (businessIds.length === 0) return;

    // Find vendor users who own these businesses
    const vendorUsers = await this.businessModel.db
      .model('User')
      .find({
        business: { $in: businessIds.map((id) => new Types.ObjectId(id)) },
        type: 'vendor',
      })
      .select('_id business full_name')
      .lean();

    const notifications: CreateNotificationDto[] = vendorUsers.map((user: any) => ({
      recipient: user._id.toString(),
      recipient_business: user.business?.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.NEW_ORDER,
      title: 'New Order Received!',
      body: `Order #${order.reference} has been placed (₦${order.total?.toLocaleString()}). Check your orders to review.`,
      metadata: {
        order_id: order._id,
        order_reference: order.reference,
        total: order.total,
        items_count: order.items.length,
        customer_name: (customer as any).full_name || '',
      },
      action_url: `/orders`,
    }));

    if (notifications.length > 0) {
      await this.notificationsService.createMany(notifications);
    }
  }

  /**
   * Notify vendors about fabric transfer shipments.
   * - Fabric vendor: "Ship X yards of [Fabric] to [Tailor]"
   * - Tailor vendor: "[Fabric Vendor] will ship fabric to you"
   */
  private async notifyFabricTransfers(order: OrderDocument) {
    const fabricTransferShipments = order.shipments.filter(
      (s: any) => s.shipment_type === ShipmentType.FABRIC_TRANSFER,
    );

    if (fabricTransferShipments.length === 0) return;

    const notifications: CreateNotificationDto[] = [];

    for (const shipment of fabricTransferShipments as any[]) {
      const fabricBizId = shipment.business?.toString();
      const tailorBizId = shipment.destination_business?.toString();

      if (!fabricBizId || !tailorBizId) continue;

      // Look up both businesses
      const [fabricBiz, tailorBiz] = await Promise.all([
        this.businessModel.findById(fabricBizId),
        this.businessModel.findById(tailorBizId),
      ]);

      if (!fabricBiz || !tailorBiz) continue;

      // Look up vendor users
      const [fabricUsers, tailorUsers] = await Promise.all([
        this.businessModel.db.model('User').find({
          business: new Types.ObjectId(fabricBizId),
          type: 'vendor',
        }).select('_id business').lean(),
        this.businessModel.db.model('User').find({
          business: new Types.ObjectId(tailorBizId),
          type: 'vendor',
        }).select('_id business').lean(),
      ]);

      const fabricYards = shipment.fabric_yards || 0;
      const fabricName = 'fabric'; // We could look up the product but keeping it simple

      // Notify fabric vendor: "Ship your fabric to the tailor"
      for (const user of fabricUsers as any[]) {
        notifications.push({
          recipient: user._id.toString(),
          recipient_business: user.business?.toString(),
          category: NotificationCategory.ORDER,
          type: NotificationType.NEW_ORDER,
          title: 'Fabric Transfer Required',
          body: `Order #${order.reference}: Ship ${fabricYards} yards of ${fabricName} to ${tailorBiz.business_name}. This is a cross-vendor bespoke order.`,
          metadata: {
            order_id: order._id,
            order_reference: order.reference,
            shipment_type: 'fabric_transfer',
            destination_business: tailorBizId,
            destination_name: tailorBiz.business_name,
          },
          action_url: `/orders`,
        });
      }

      // Notify tailor vendor: "Fabric is coming to you"
      for (const user of tailorUsers as any[]) {
        notifications.push({
          recipient: user._id.toString(),
          recipient_business: user.business?.toString(),
          category: NotificationCategory.ORDER,
          type: NotificationType.NEW_ORDER,
          title: 'External Fabric Incoming',
          body: `Order #${order.reference}: ${fabricBiz.business_name} will ship ${fabricYards} yards of ${fabricName} to you. You'll be notified when it arrives so you can start working.`,
          metadata: {
            order_id: order._id,
            order_reference: order.reference,
            shipment_type: 'fabric_transfer_incoming',
            source_business: fabricBizId,
            source_name: fabricBiz.business_name,
          },
          action_url: `/orders`,
        });
      }
    }

    if (notifications.length > 0) {
      await this.notificationsService.createMany(notifications);
    }
  }

  /**
   * Notify vendors that an order was cancelled.
   */
  private async notifyVendorsOrderCancelled(order: OrderDocument) {
    const businessIds = [
      ...new Set(
        order.items
          .map((item: any) => item.business?.toString())
          .filter(Boolean),
      ),
    ];

    if (businessIds.length === 0) return;

    const vendorUsers = await this.businessModel.db
      .model('User')
      .find({
        business: { $in: businessIds.map((id) => new Types.ObjectId(id)) },
        type: 'vendor',
      })
      .select('_id business')
      .lean();

    const notifications: CreateNotificationDto[] = vendorUsers.map((user: any) => ({
      recipient: user._id.toString(),
      recipient_business: user.business?.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Order Cancelled',
      body: `Order #${order.reference} has been cancelled and refunded.`,
      metadata: {
        order_id: order._id,
        order_reference: order.reference,
        total: order.total,
      },
      action_url: `/orders`,
    }));

    if (notifications.length > 0) {
      await this.notificationsService.createMany(notifications);
    }
  }
}
