import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Order, OrderDocument } from './schemas/orders.schema';
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
  AccessoryDocument,
  DiscountDocument,
  FabricDocument,
  ProductDocument,
  StyleDocument,
} from '../products/schemas';
import { ProcessedOrderItemDto } from './dto/order-item.dto';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';
import {
  TransactionDocument,
  TransactionStatus,
  TransactionType,
} from '../transactions/schema/transaction.schema';
import { Utils } from '../../common/utils/pagination';
import { AddressDocument } from '../ums/schemas/address.schema';
import { OrderItemSelectionsDto } from './dto/selection.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private validationService: OrderValidationService,
    private priceCalculationService: PriceCalculationService,
    @InjectModel('Product') private productModel: Model<ProductDocument>,
    @InjectModel('Style') private styleModel: Model<StyleDocument>,
    @InjectModel('Fabric') private fabricModel: Model<FabricDocument>,
    @InjectModel('Accessory') private accessoryModel: Model<AccessoryDocument>,
    @InjectModel('Discount') private discountModel: Model<DiscountDocument>,
    @InjectModel('Address') private addressModel: Model<AddressDocument>,
    @InjectModel('Transaction')
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async createOrder(
    orderData: CreateOrderDto,
    business: string,
    customer: string,
  ): Promise<OrderDocument> {
    await this.validationService.validateCompleteOrder(orderData.items);
    const shippingAddress = await this.resolveShippingAddress(customer);
    const processedItems = await this.processOrderItems(orderData.items);
    const orReference = await generateUniqueQlozetReference(
      this.orderModel,
      'ORD',
    );

    const { total, subtotal } =
      await this.priceCalculationService.calculateOrderTotal(processedItems);

    const normalizedItems = processedItems.map((item) => {
      const selections = item.selections || {};

      return {
        product: item.product_id,
        note: item.note,
        product_kind: item.product_kind,
        clothing_type: item.clothing_type,
        variant_selections: selections.variant_selection || [],
        fabric_selections: selections.fabric_selection || [],
        style_selections: selections.style_selection || [],
        accessory_selections: selections.accessory_selection || [],
        total_price: total ?? 0,
        subtotal,
      };
    });

    const order = new this.orderModel({
      reference: orReference,
      customer: new Types.ObjectId(customer), // ensure ObjectId
      addresses: shippingAddress,
      items: normalizedItems,
      status: 'pending',
      subtotal,
      shipping_fee: 0,
      total,
    });

    const savedOrder = await order.save();

    const txReference = await generateUniqueQlozetReference(
      this.transactionModel,
      'TXN',
    );

    await this.createTransaction({
      business: new Types.ObjectId(business),
      initiator: savedOrder.customer,
      order: savedOrder?.id,
      type: TransactionType.DEBIT,
      amount: savedOrder.total,
      status: TransactionStatus.PENDING,
      reference: txReference,
      description: `Order payment for order ${savedOrder.reference}`,
      channel: 'checkout',
      metadata: {
        order_reference: savedOrder.reference,
        items_count: savedOrder.items.length,
      },
    });

    return savedOrder;
  }

  private async createTransaction(
    transactionData: Partial<TransactionDocument>,
  ): Promise<TransactionDocument> {
    const transaction = new this.transactionModel(transactionData);
    return await transaction.save();
  }
  // processOrderItems (fixed)
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

        // Normalize incoming selections (keep original plural props for lookups)
        const rawSelections = this.normalizeSelections(item.selections);

        // Prefer plural arrays if present, fall back to singular aliases (supports either input shape)
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
        const variantSelections =
          rawSelections.variant_selection ??
          rawSelections.variant_selection ??
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

        const selections = this.normalizeSelections(item.selections);

        const itemForPricing: ProcessedOrderItem = {
          ...item,
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
          variant_selection: variantSelections,
          style_selection: styleSelections,
          fabric_selection: fabricSelections,
          accessory_selection: accessorySelections,
        };

        return {
          product_id: item.product_id,
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

  private normalizeSelections(
    selections?: OrderItemSelectionsDto,
  ): NormalizedSelections {
    if (!selections) {
      return {
        variant_selection: [],
        style_selection: [],
        fabric_selection: [],
        accessory_selection: [],
      };
    }

    return {
      variant_selection:
        selections.color_variant_selections ??
        selections.color_variant_selections ??
        [],
      style_selection:
        selections.style_selections ?? selections.style_selections ?? [],
      fabric_selection:
        selections.fabric_selections ?? selections.fabric_selections ?? [],
      accessory_selection:
        selections.accessory_selections ??
        selections.accessory_selections ??
        [],
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

  private async updateInventory(items: ProcessedOrderItem[]): Promise<void> {
    for (const item of items) {
      // Update inventory based on item type and selections
      await this.updateItemInventory(item);
    }
  }

  private async updateItemInventory(item: ProcessedOrderItem): Promise<void> {
    switch (item.product_kind) {
      case ProductKind.FABRIC:
        await this.updateFabricInventory(item);
        break;
      case ProductKind.ACCESSORY:
        await this.updateAccessoryInventory(item);
        break;
      case ProductKind.CLOTHING:
        await this.updateClothingInventory(item);
        break;
    }
  }

  private async updateFabricInventory(item: ProcessedOrderItem): Promise<void> {
    if (item.selections.fabric_selection) {
      // const fabric = await this.fabricModel.findById(
      //   item.selections.fabric_selection.fabric_id,
      // );
      // if (fabric && fabric.yard_length !== undefined) {
      //   fabric.yard_length -= item.selections.fabric_selection.yardage;
      //   await fabric.save();
      // }
    }
  }

  private async updateAccessoryInventory(
    item: ProcessedOrderItem,
  ): Promise<void> {
    const accessories = item.selections.accessory_selection;

    if (accessories && accessories?.length > 0) {
      for (let accessory of accessories) {
        const isAccessoryExist = await this.accessoryModel.findById(
          accessory?.accessory_id,
        );
        // if (isAccessoryExist) {
        //   if (item.selections.accessory_selection.variant_id) {
        //     const variant = accessory.accessory.variants.find(
        //       (v: any) =>
        //         v._id.toString() ===
        //         item.selections.accessory_selection!.variant_id!.toString(),
        //     );
        //     if (variant && variant.stock !== undefined) {
        //       variant.stock -= item.selections.accessory_selection.quantity;
        //       await accessory.save();
        //     }
        //   }
        // }
      }
    }
  }
  private calculateDiscountDeduction(discount: any, basePrice: number): number {
    const value = discount.value || 0;

    switch (discount.type) {
      case 'fixed':
      case 'flash_fixed':
      case 'category_specific':
        return Math.min(value, basePrice);

      case 'percentage':
      case 'flash_percentage':
      case 'store_wide':
        return (basePrice * value) / 100;

      default:
        return 0;
    }
  }

  private async updateClothingInventory(
    item: ProcessedOrderItem,
  ): Promise<void> {
    if (
      item.clothing_type === ClothingType.NON_CUSTOMIZE &&
      item.selections.variant_selection
    ) {
      for (const variant of item.selections.variant_selection) {
        const clothing = await this.productModel.findById(item.product_id);
        if (clothing && clothing.clothing?.color_variants) {
          const colorVariant = clothing.clothing.color_variants.find(
            (v: any) => v._id.toString() === variant.variant_id.toString(),
          );
          if (!colorVariant)
            throw new BadRequestException(
              `Color variant not found: ${variant.variant_id}`,
            );
          for (const v of colorVariant?.variants) {
            if (v && v.stock !== undefined) {
              v.stock -= variant.quantity;
              await clothing.save();
            }
          }
        }
      }
    }
    // For customize clothing, no inventory update needed as it's made-to-order
  }
  async findVendorOrders(
    vendorId: Types.ObjectId,
    page: number = 1,
    size: number = 10,
    status?: string,
  ): Promise<{
    data: any[];
    total_items: number;
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const { skip, take } = await Utils.getPagination(page, size);
    const vendorProductIds = await this.getVendorProductIds(vendorId);

    const matchQuery: any = {
      'items.product_id': { $in: vendorProductIds },
    };

    if (status && status !== 'all') {
      matchQuery.status = status;
    }

    const aggregationPipeline: any[] = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer',
          pipeline: [{ $project: { firstName: 1, lastName: 1, email: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product_id',
          foreignField: '_id',
          as: 'productDetails',
          pipeline: [
            {
              $match: {
                _id: { $in: vendorProductIds },
                vendor: vendorId,
              },
            },
            {
              $project: {
                name: 1,
                base_price: 1,
                kind: 1,
                fabric: 1,
                accessory: 1,
                clothing: 1,
                discounted_price: 1,
                vendor: 1,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          customer: { $arrayElemAt: ['$customer', 0] },
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    product_details: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$productDetails',
                            as: 'product',
                            cond: {
                              $eq: ['$$product._id', '$$item.product_id'],
                            },
                          },
                        },
                        0,
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: { $ne: ['$$item.product_details', null] },
            },
          },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: take }],
        },
      },
    ];

    const [result] = await this.orderModel
      .aggregate(aggregationPipeline)
      .exec();

    const data = result?.data || [];
    const total = result?.metadata?.[0]?.total || 0;

    return Utils.getPagingData({ count: total, rows: data }, page, size);
  }

  private async getVendorProductIds(
    vendorId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const vendorProducts = await this.productModel
      .find({ vendor: vendorId })
      .select('_id')
      .lean()
      .exec();

    return vendorProducts.map((p) => p.id);
  }

  async findCustomerOrdersWithFilters(
    customerId: Types.ObjectId,
    page: number = 1,
    size: number = 10,
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
}
