import { Length } from 'class-validator';
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
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
import { PriceItemDto } from './dto/price-item.dto';
import { generateUniqueQlozetReference } from '../../common/utils/generateString';
import { TransactionType, TransactionStatus } from '../transactions/schema/transaction.schema';
import { Utils } from '../../common/utils/pagination';
import { ObjectIdUtils } from '../../common/utils/objectId.utils';
import { AddressDocument } from '../ums/schemas/address.schema';
import {
  AccessorySelectionDto,
  AddonSelectionDto,
  FabricSelectionDto,
  OrderItemSelectionsDto,
  StyleSelectionDto,
  VariantSelectionDto,
} from './dto/selection.dto';
import { TransactionService } from '../transactions/transactions.service';
import { User } from '../ums/schemas';
import { LogisticsService } from '../logistics/logistics.service';
import { PaymentService } from '../payment/payment.service';
import { BusinessService } from '../business/business.service';
import { ProductService } from '../products/products.service';
import { computeAvailability } from '../products/product-availability';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { BusinessEarningDocument } from '../business/schemas/business-earnings.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
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
import { estimateProductWeightKg } from '../../common/constants/product-weight.constant';
import { NotificationsService, CreateNotificationDto } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Cron } from '@nestjs/schedule';

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
    @InjectModel('Dispute') private disputeModel: Model<any>,
    @Inject(forwardRef(() => WalletsService))
    private readonly walletsService: WalletsService,
    private readonly notificationsService: NotificationsService,
    private readonly businessService: BusinessService,
    private readonly productService: ProductService,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
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
          // The selection pipeline names the chosen size-variant id
          // `color_variant_id`, but the persisted OrderItem schema field is
          // `variant_id` (what inventory deduction reads). Map it here so the
          // id is actually stored — otherwise stock is never reduced.
          color_variant_selections: (selections.color_variant_selection || []).map(
            (cv: any) => ({
              variant_id: cv.variant_id ?? cv.color_variant_id,
              size: cv.size,
              price: cv.price,
              quantity: cv.quantity,
              total_amount: cv.total_amount,
            }),
          ),
          fabric_selections: selections.fabric_selection || [],
          style_selections: selections.style_selection || [],
          accessory_selections: selections.accessory_selection || [],
          addon_selections: selections.addon_selection || [],
          // Customer-supplied external fabric (schema fields on OrderItem). The
          // vendor read populates `applied_fabric` → fabric name/image/source,
          // so the tailor sees which foreign fabric to use. Without this the
          // populate resolves to null and the fabric card is always empty.
          applied_fabric: (item as any).applied_fabric_id
            ? ObjectIdUtils.toObjectId((item as any).applied_fabric_id)
            : null,
          applied_fabric_yards: (item as any).applied_fabric_yards ?? null,
          // Per-item price (computed in processOrderItems). Must NOT be the
          // whole-order total, otherwise recordBusinessEarnings over-credits
          // each vendor on multi-item orders.
          total_price: item.total_price ?? 0,
          subtotal: item.total_price ?? 0,
          pricing: (item as any).pricing,
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

          // Persist the courier ETA so the fabric card + SLA warning have it.
          const etaRaw = (matchedRate as any).delivery_eta;
          const etaDays =
            typeof etaRaw === 'number'
              ? etaRaw
              : (String(etaRaw ?? '').match(/\d+/)?.[0]
                  ? Number(String(etaRaw).match(/\d+/)![0])
                  : null);
          const etaTime = (matchedRate as any).delivery_eta_time;

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
            eta_days: etaDays,
            expected_delivery_at: etaTime ? new Date(etaTime) : null,
          });
          totalShippingFee += verifiedTransferFee;
        }
      }

      // Customer-supplied external fabric ("use my own fabric") is billed at the
      // order level — added to the goods subtotal (and thus the charged total) so
      // the customer pays for the fabric, without inflating any item's
      // total_price (which drives the tailor's earnings; the fabric is the fabric
      // vendor's revenue, reconciled separately).
      const totalExternalFabric = processedItems.reduce(
        (sum, it) => sum + ((it as any).pricing?.external_fabric || 0),
        0,
      );
      const goodsSubtotal = subtotal + totalExternalFabric;
      const finalTotal = goodsSubtotal + totalShippingFee;

      // Every standard order must carry at least one shipment so the vendor can
      // fulfill it (fulfillment needs the shipment's cached rate token, which
      // only checkout can mint). Bespoke orders are created via a separate path
      // and are exempt from this check.
      if (normalizedItems.length > 0 && shipments.length === 0) {
        throw new BadRequestException(
          'Please select a shipping option for each vendor before placing your order.',
        );
      }

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
        subtotal: goodsSubtotal,
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

        // Deduct inventory BEFORE moving money. If stock is short (e.g. not
        // enough fabric yardage) this throws here — before any debit — so the
        // wallet is never charged for an order that cannot be fulfilled.
        try {
          await this.productService.updateInventory(
            savedOrder._id as Types.ObjectId,
          );
        } catch (invErr) {
          await this.orderModel.deleteOne({ _id: savedOrder._id });
          throw invErr;
        }

        // Debit wallet
        await this.walletsService.debitWallet(wallet._id.toString(), savedOrder.total);

        // Everything past the debit is compensated on failure: refund the
        // wallet, restore inventory and delete the order so the customer is
        // never left out of pocket for an order that did not complete.
        let transaction: any;
        try {
          // Create transaction record
          transaction = await this.transactionService.create({
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

          // Mark order as in_review (awaiting vendor confirmation)
          savedOrder.status = OrderStatus.IN_REVIEW;
          (savedOrder as any).payment_status = 'paid';
          await savedOrder.save();

          // Record vendor earnings (inventory already deducted above)
          await this.businessService.recordBusinessEarnings(
            savedOrder._id as Types.ObjectId,
          );
        } catch (postErr) {
          await this.walletsService
            .creditWallet(wallet._id.toString(), savedOrder.total)
            .catch((e) =>
              this.logger.error('Wallet refund after failed order failed', e),
            );
          await this.productService
            .restoreInventory(savedOrder._id as Types.ObjectId)
            .catch((e) =>
              this.logger.error(
                'Inventory restore after failed order failed',
                e,
              ),
            );
          await this.orderModel
            .deleteOne({ _id: savedOrder._id })
            .catch(() => undefined);
          throw postErr;
        }

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

  /**
   * Authoritatively price a single configured item — the SAME math the cart and
   * order use (calculateItemTotal) — so the product page can display the real
   * price instead of a client-side estimate. Returns the per-unit price.
   */
  async priceItem(dto: PriceItemDto): Promise<{ data: { price: number; breakdown: any } }> {
    const s = dto.selections as any;
    const normalized = {
      color_variant_selection: s?.color_variant_selections ?? [],
      style_selection: s?.style_selections ?? [],
      fabric_selection: s?.fabric_selections ?? [],
      accessory_selection: s?.accessory_selections ?? [],
      addon_selection: s?.addon_selections ?? [],
    };

    let breakdown: any;
    try {
      breakdown = await this.priceCalculationService.calculateItemBreakdown({
        product_id: dto.product_id,
        quantity: 1,
        selections: normalized,
      } as any);
    } catch {
      const product: any = await this.productModel
        .findById(dto.product_id)
        .lean();
      const base =
        product?.discounted_price != null &&
        product.discounted_price > 0 &&
        product.discounted_price < product.base_price
          ? product.discounted_price
          : product?.base_price ?? 0;
      breakdown = {
        base, styles_total: 0, fabric_total: 0, variant_total: 0,
        accessories_total: 0, addons_total: 0,
        before_discount: base, discount: 0, final: base,
      };
    }

    // External applied fabric (cross-vendor) — a separate line, not discounted.
    let externalFabric = 0;
    if (dto.applied_fabric_id && dto.applied_fabric_yards) {
      const fab: any = await this.productModel
        .findById(dto.applied_fabric_id)
        .lean();
      const ppy = fab?.fabric?.price_per_yard;
      if (ppy) externalFabric = ppy * dto.applied_fabric_yards;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    breakdown.external_fabric = round(externalFabric);
    breakdown.before_discount = round(breakdown.before_discount + externalFabric);
    breakdown.final = round(breakdown.final + externalFabric);

    return { data: { price: breakdown.final, breakdown } };
  }

  /**
   * Per-unit price (yardage/customization aware) for a product + selections,
   * using the same pricing brain as the cart/order. Falls back to the flat
   * (discounted) price if the breakdown can't be computed. Selections use the
   * cart's plural keys and are mapped to the calculator's singular keys.
   */
  private async resolvePerUnitAmount(
    product: any,
    selections: any,
  ): Promise<number> {
    const flat =
      product?.discounted_price != null &&
      product.discounted_price > 0 &&
      product.discounted_price < product.base_price
        ? product.discounted_price
        : product?.base_price || 0;
    try {
      const s = selections || {};
      const breakdown =
        await this.priceCalculationService.calculateItemBreakdown({
          product_id: String(product._id),
          quantity: 1,
          selections: {
            color_variant_selection: s.color_variant_selections ?? [],
            style_selection: s.style_selections ?? [],
            fabric_selection: s.fabric_selections ?? [],
            accessory_selection: s.accessory_selections ?? [],
            addon_selection: s.addon_selections ?? [],
          },
        } as any);
      const final = Number(breakdown?.final);
      return final > 0 ? final : flat;
    } catch {
      return flat;
    }
  }

  /**
   * Build a Shipbubble package_item (courier manifest line) with an accurate
   * declared value and, for fabric, the yardage baked into the name plus a
   * yard-scaled weight — so the vendor's shipment email shows how many yards to
   * cut and the real order value (instead of a flat base price and QTY 1).
   */
  private buildManifestItem(opts: {
    name: string;
    kind?: string | null;
    unitAmount: number;
    quantity: number;
    fabricYards?: number | null;
    baseWeightKg?: number;
  }) {
    const isFabric = opts.kind === 'fabric';
    const yards =
      opts.fabricYards && opts.fabricYards > 0 ? opts.fabricYards : null;
    const name = isFabric && yards ? `${opts.name} — ${yards} yd` : opts.name;
    const unit_weight =
      isFabric && yards
        ? Math.max(0.1, Math.round(yards * 0.3 * 100) / 100)
        : Math.max(0.1, opts.baseWeightKg || 0.5);
    return {
      name,
      description: name,
      unit_weight,
      unit_amount: Math.max(0, Math.round((opts.unitAmount || 0) * 100) / 100),
      quantity: Math.max(1, Math.round(opts.quantity || 1)),
    };
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
        const addonSelections =
          rawSelections.addon_selection ??
          rawSelections.addon_selection ??
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
        // Price the item on the RESOLVED selections (with the product), not a
        // re-normalize without the product — that returned empty selections, so
        // item.total_price was base-only (missing all components), diverging
        // from the order total and under-crediting vendor earnings.
        const itemForPricing: ProcessedOrderItem = {
          ...item,
          product_name: name,
          business: product?.business,
          selections: rawSelections,
          total_price: 0,
          discount_snapshot: discountSnapshot
            ? this.sanitizeDiscountSnapshot(discountSnapshot)
            : undefined,
        };

        // One call yields both the itemized breakdown and the final total.
        const pricing =
          await this.priceCalculationService.calculateItemBreakdown(itemForPricing);
        const totalPrice = pricing.final;

        // Build the final selections shape that matches ProcessedOrderItem interface:
        const finalSelections = {
          color_variant_selection: colorVariantSelections,
          style_selection: styleSelections,
          fabric_selection: fabricSelections,
          accessory_selection: accessorySelections,
          addon_selection: addonSelections,
        };

        return {
          product_id: item.product_id,
          product_name: name,
          business: product?.business,
          product_kind: product.kind as ProductKind,
          clothing_type: product.clothing?.type as ClothingType,
          note: item.note,
          quantity: item.quantity,
          selections: finalSelections,
          // Carry the customer's applied external fabric through so it lands on
          // the persisted order item (normalizedItems below reads these).
          applied_fabric_id: item.applied_fabric_id,
          applied_fabric_yards: item.applied_fabric_yards,
          total_price: totalPrice,
          pricing,
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

      // Keep `quantity` as the number of garments/cuts — do NOT fold yardage in.
      // Downstream, both the price calc (calculateFabricCost) and the stock
      // deduction (updateFabric) multiply yardage × quantity. Folding yardage in
      // here double-counted it (yardage²), which inflated the order total vs the
      // PDP/cart price AND raised false "not enough fabric" errors at checkout.
      const quantity = fs.quantity ?? 1;
      normalizedFabrics.push({
        fabric_id: new Types.ObjectId(isFabricExist._id),
        price: isFabricExist.price_per_yard,
        quantity,
        yardage,
        total_amount: isFabricExist.price_per_yard * yardage * quantity,
      });
    }

    // --- Accessories ---
    const normalizedAccessories: AccessorySelectionDto[] = [];
    for (const as of selections.accessory_selections || []) {
      const isAccessoryExist =
        clothing?.accessories?.find((a) => a._id?.equals(as.accessory_id)) ??
        accessory;

      if (!isAccessoryExist) continue;

      // Variant is optional — it only pins stock. Accessories are priced at
      // their base price, so keep the accessory even when it has no (matching)
      // variant, instead of silently dropping a selection the PDP had priced.
      const accessoryVariant = as.variant_id
        ? isAccessoryExist.variants?.find((av) => av._id?.equals(as.variant_id))
        : undefined;

      const quantity = as.quantity ?? 1;
      normalizedAccessories.push({
        accessory_id: new Types.ObjectId(isAccessoryExist._id),
        variant_id: accessoryVariant?._id
          ? new Types.ObjectId(accessoryVariant._id)
          : undefined,
        price: isAccessoryExist.price,
        quantity,
        total_amount: isAccessoryExist.price * quantity,
      });
    }

    // --- Addons ---
    const normalizedAddons: AddonSelectionDto[] = [];
    for (const ads of selections.addon_selections || []) {
      const addon = clothing?.addons?.find(a => a._id?.equals(ads.addon_id));
      if (!addon) continue;

      const variant = addon.variants?.find(v => v._id?.equals(ads.variant_id));
      if (!variant) continue;

      const quantity = ads.quantity ?? 1;
      normalizedAddons.push({
        addon_id: new Types.ObjectId(addon._id),
        variant_id: new Types.ObjectId(variant._id),
        price: variant.price || 0,
        quantity,
        total_amount: (variant.price || 0) * quantity,
      });
    }

    return {
      color_variant_selection: normalizedColorVariants,
      style_selection: normalizedStyles,
      fabric_selection: normalizedFabrics,
      accessory_selection: normalizedAccessories,
      addon_selection: normalizedAddons,
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
      // _id narrows to a single doc (indexed); refMatch tolerates a string- or
      // ObjectId-typed customer without a full-collection scan.
      address = await this.addressModel.findOne({
        _id: addressId,
        ...ObjectIdUtils.refMatch('customer', customerId),
      });
      if (!address) {
        throw new BadRequestException(
          'Specified address not found or does not belong to customer',
        );
      }
    } else {
      // Try default, then fallback to any
      address = await this.addressModel.findOne({
        ...ObjectIdUtils.refMatch('customer', customerId),
        is_default: true,
      });
      if (!address) {
        address = await this.addressModel.findOne(
          ObjectIdUtils.refMatch('customer', customerId),
        );
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
        // A vendor's orders include (a) those where they sell an item, AND
        // (b) those where they are the SOURCE of a shipment — specifically a
        // fabric vendor shipping their fabric to a tailor for a cross-vendor
        // "use my own fabric" order. The fabric vendor is only on the
        // fabric_transfer shipment, never on an order item, so filtering by
        // items.business alone hid those orders from them entirely.
        filter['$or'] = [
          { 'items.business': business },
          { 'shipments.business': business },
        ];
      }
      if (status && status !== 'all') {
        filter.status = status;
      }

      const [orders, total] = await Promise.all([
        this.orderModel
          .find(filter)
          // Include the clothing sub-arrays (styles / fabrics / accessories /
          // addons / color_variants) so the vendor UI can resolve each
          // selection's NAME + IMAGE + price by its id — otherwise the item
          // detail can only show generic "Style / Fabric / Accessory" labels.
          .populate(
            'items.product',
            'name base_price kind ' +
              'clothing.name clothing.images clothing.type clothing.description ' +
              'clothing.styles clothing.fabrics clothing.accessories clothing.addons clothing.color_variants ' +
              'fabric.name fabric.images accessory.name accessory.images',
          )
          // Cross-vendor fabric applied to a custom outfit — populate the fabric
          // product (name + images) AND its owning vendor, so the tailor sees
          // what external fabric is coming and from whom.
          .populate({
            path: 'items.applied_fabric',
            select: 'fabric.name fabric.images base_price business',
            populate: {
              path: 'business',
              select: 'business_name business_logo_url',
            },
          })
          .populate('customer', 'email username firstName lastName')
          .populate('shipments.business', 'business_name business_logo_url')
          // Include the tailor's ship-to address on the destination business —
          // a fabric-transfer-only vendor needs somewhere to send the fabric,
          // and the scoped view (below) surfaces this instead of the customer's
          // delivery address.
          .populate(
            'shipments.destination_business',
            'business_name business_logo_url business_phone_number ' +
              'business_address validated_address address_line_2 state city',
          )
          .populate(
            'shipments.fabric_product',
            'fabric.name fabric.images base_price',
          )
          // Bespoke orders: bring the design so the tailor sees what to make.
          .populate(
            'bespoke_design',
            'name category gender design_images reference_images description fabric',
          )
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(take)
          .lean(),
        this.orderModel.countDocuments(filter),
      ]);

      // Privacy scoping: a fabric vendor only appears on an order as the SOURCE
      // of a fabric_transfer shipment (never on an item). They must be able to
      // see that transfer to ship it, but must NOT see the customer, the design,
      // the other vendor's items, the order totals, or anyone's earnings. Trim
      // each order down to just their transfer slice when that's their only role.
      // The fabric-vendor breakdown (value − commission = earnings) mirrors the
      // real earning formula, so load the platform commission settings once.
      const settings = business
        ? await this.platformSettingsModel.findOne().lean()
        : null;
      const commissionParams = {
        type: (settings as any)?.platform_commission_type ?? 'percent',
        percent: (settings as any)?.platform_commission_percent ?? 10,
        flat: (settings as any)?.platform_commission_flat ?? 0,
      };

      let scopedRows = business
        ? orders.map((o) => {
            const scoped = this.scopeOrderForVendor(
              o,
              String(business),
              commissionParams,
            );
            // Fabric-transfer-only orders already carry their own fabric_*
            // breakdown; real (garment) vendors get a per-vendor breakdown of
            // THEIR items. order.vendor_earnings is order-wide and — on a
            // "use my own fabric" order — also includes the fabric vendor's net,
            // which would otherwise inflate this vendor's earnings and hide the
            // commission line. Compute it from their items instead.
            if ((scoped as any)?.vendor_role === 'fabric_transfer')
              return scoped;
            return {
              ...(scoped as any),
              vendor_breakdown: this.computeVendorBreakdown(
                scoped,
                String(business),
                commissionParams,
              ),
            };
          })
        : orders;

      // Attach each fabric transfer's real payout state from the vendor's
      // BusinessEarning (their own, not the tailor's order.payout_status). One
      // batched query for the whole page.
      if (business) {
        const fabricOrderIds = scopedRows
          .filter((r: any) => r?.vendor_role === 'fabric_transfer')
          .map((r: any) => r._id);
        if (fabricOrderIds.length) {
          const earnings = await this.businessEarningsModel
            .find({ business, order: { $in: fabricOrderIds } })
            .select('order released release_date')
            .lean();
          const byOrder = new Map<
            string,
            { released: boolean; hasDate: boolean; any: boolean }
          >();
          for (const e of earnings as any[]) {
            const k = String(e.order);
            const cur = byOrder.get(k) ?? {
              released: true,
              hasDate: false,
              any: false,
            };
            cur.released = cur.released && !!e.released;
            cur.hasDate = cur.hasDate || !!e.release_date;
            cur.any = true;
            byOrder.set(k, cur);
          }
          scopedRows = scopedRows.map((r: any) => {
            if (r?.vendor_role !== 'fabric_transfer') return r;
            const agg = byOrder.get(String(r._id));
            const payout_status =
              !agg || !agg.any
                ? 'pending'
                : agg.released
                  ? 'paid'
                  : agg.hasDate
                    ? 'eligible'
                    : 'pending';
            return { ...r, payout_status };
          });
        }
      }

      return Utils.getPagingData(
        {
          count: total,
          rows: scopedRows,
        },
        page,
        size,
      );
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }

  /**
   * If `businessId` is on this order ONLY as the source of a fabric_transfer
   * shipment (i.e. a cross-vendor "use my own fabric" transfer — never on an
   * order item, and with no vendor_to_customer shipment of their own), return a
   * trimmed order exposing just that transfer. Everything else about the order
   * belongs to the customer and the tailor, so it's stripped. Any vendor who
   * actually sells on the order (has an item or their own garment shipment) gets
   * the full order unchanged.
   */
  /**
   * The requesting vendor's own money breakdown for an order: subtotal of THEIR
   * items, platform commission on it, and their net. Mirrors the per-business
   * earning formula in recordBusinessEarnings (gross = sum of item finals,
   * commission = gross × rate). Used instead of order.vendor_earnings, which is
   * order-wide and — on a "use my own fabric" order — also folds in the fabric
   * vendor's net, over-stating this vendor's earnings.
   */
  private computeVendorBreakdown(
    order: any,
    businessId: string,
    commission?: { type: string; percent: number; flat: number },
  ) {
    const bid = String(businessId);
    const myItems = (order?.items || []).filter(
      (i: any) => String(i?.business) === bid,
    );
    const cType = commission?.type ?? 'percent';
    const cPercent = commission?.percent ?? 10;
    const cFlat = commission?.flat ?? 0;
    // Per-item, matching recordBusinessEarnings (a fixed fee is charged per
    // item, so summing per-item is not the same as one fee on the subtotal).
    let subtotal = 0;
    let commissionAmt = 0;
    for (const it of myItems) {
      const gross = it?.total_price ?? it?.pricing?.final ?? 0;
      subtotal += gross;
      commissionAmt +=
        cType === 'fixed' ? Math.min(cFlat, gross) : gross * (cPercent / 100);
    }
    return { subtotal, commission: commissionAmt, net: subtotal - commissionAmt };
  }

  private scopeOrderForVendor(
    order: any,
    businessId: string,
    commission?: { type: string; percent: number; flat: number },
  ) {
    const bid = String(businessId);
    const shipments: any[] = order.shipments || [];
    const items: any[] = order.items || [];

    const shipmentBizId = (s: any) => String(s?.business?._id ?? s?.business);

    const hasItem = items.some((i) => String(i?.business) === bid);
    const hasOwnGarmentShipment = shipments.some(
      (s) =>
        shipmentBizId(s) === bid &&
        s.shipment_type === ShipmentType.VENDOR_TO_CUSTOMER,
    );
    const fabricTransfers = shipments.filter(
      (s) =>
        shipmentBizId(s) === bid &&
        s.shipment_type === ShipmentType.FABRIC_TRANSFER,
    );

    // A real participant (sells an item and/or has their own garment shipment):
    // return only THEIR slice of the order. A shared multi-vendor basket is one
    // order in the DB, so without this the API would ship other vendors' items,
    // prices and shipments to this vendor.
    if (hasItem || hasOwnGarmentShipment) {
      const myItems = items.filter((i) => String(i?.business) === bid);
      const bd = this.computeVendorBreakdown(order, bid, commission);
      // Keep only the shipments this vendor is involved in: their own
      // (vendor_to_customer, or an outgoing fabric transfer they send) and any
      // INCOMING fabric transfer destined for them (the drawer's "wait for
      // fabric" gate needs it). Other vendors' shipments are stripped.
      const myShipments = shipments.filter((s) => {
        const src = shipmentBizId(s);
        const dst = String(
          s?.destination_business?._id ?? s?.destination_business,
        );
        return (
          src === bid ||
          (s.shipment_type === ShipmentType.FABRIC_TRANSFER && dst === bid)
        );
      });
      const myShippingFee =
        myShipments.find(
          (s) =>
            shipmentBizId(s) === bid &&
            s.shipment_type === ShipmentType.VENDOR_TO_CUSTOMER,
        )?.shipping_fee ?? 0;
      return {
        ...order,
        items: myItems,
        shipments: myShipments,
        subtotal: bd.subtotal,
        shipping_fee: myShippingFee,
        // THIS vendor's own total — their goods + their delivery, not the whole
        // multi-vendor basket. (The customer's external "use my own fabric"
        // charge is the fabric vendor's revenue and is excluded from item
        // total_price, so it isn't part of the tailor's total here.)
        total: bd.subtotal + myShippingFee,
        vendor_earnings: bd.net,
        platform_commission: bd.commission,
      };
    }

    // On the order via nothing recognisable (shouldn't happen — the query only
    // returns orders the vendor is on) and not a fabric-transfer source.
    if (fabricTransfers.length === 0) {
      return order;
    }

    // Fabric-transfer-only vendor → expose just their transfer(s). Surface the
    // transfer's own lifecycle as the status (not the whole order's), since the
    // order completing means the tailor delivered to the customer — not this
    // vendor's concern.
    const primary = fabricTransfers[0];

    // The money the fabric vendor actually earns on this order: the customer's
    // "use my own fabric" charge, which is billed as each garment item's
    // pricing.external_fabric and is this vendor's fabric revenue. Match the
    // items whose applied_fabric product belongs to this vendor (same owner as
    // the transfer's `business`). This is what turns the scoped view from a bare
    // "transfer" into a real fabric order (vendor → vendor).
    const fabricValue = items.reduce((sum, it) => {
      const af = it?.applied_fabric;
      const afBizId =
        af && typeof af === 'object'
          ? String(af.business?._id ?? af.business)
          : null;
      return afBizId === bid ? sum + (it?.pricing?.external_fabric || 0) : sum;
    }, 0);

    // Platform commission on the fabric sale — same formula as the real fabric-
    // vendor earning (business.service recordBusinessEarnings), so the drawer
    // can show value − commission = earnings like any regular order.
    const cType = commission?.type ?? 'percent';
    const cPercent = commission?.percent ?? 10;
    const cFlat = commission?.flat ?? 0;
    const fabricCommission =
      cType === 'fixed'
        ? Math.min(cFlat, fabricValue)
        : fabricValue * (cPercent / 100);
    const fabricNet = fabricValue - fabricCommission;

    return {
      _id: order._id,
      reference: order.reference,
      // The fabric vendor's gross revenue for this order (customer-paid), the
      // platform commission taken from it, and their net earnings — released to
      // their wallet once the transfer is delivered.
      fabric_value: fabricValue,
      fabric_commission: fabricCommission,
      fabric_net: fabricNet,
      // NOTE: `type` (standard/bespoke) is deliberately omitted — a bespoke
      // clothing order would otherwise route the vendor UI into the quote/design
      // drawer, leaking the customer's design + measurements to the fabric vendor.
      // Discriminator the vendor UI branches on to render the transfer card
      // instead of the full order/customer/design view.
      vendor_role: 'fabric_transfer',
      status: primary?.status ?? null,
      shipments: fabricTransfers,
      // Empty (not omitted) so any incidental `order.items` access on the client
      // degrades to "no items" instead of throwing.
      items: [],
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /**
   * Read the measurement set of the customer on an order. Order-scoped so it's
   * not a general PII read: the vendor must own a shipment/item on the order
   * (pass their businessId); admin passes no businessId. Contact PII
   * (email/phone) is intentionally dropped — only the raw measurements + unit.
   */
  async getOrderCustomerMeasurements(
    reference: string,
    scopeBusinessId?: string,
  ) {
    const order = await this.orderModel
      .findOne({ reference })
      .select('customer items shipments')
      .lean();
    if (!order) throw new NotFoundException('Order not found');

    if (scopeBusinessId) {
      const bid = String(scopeBusinessId);
      // Must be a real seller on the order — an item, or their own
      // garment (vendor_to_customer) shipment. A fabric_transfer SOURCE does not
      // qualify: shipping fabric to the tailor doesn't grant access to the
      // customer's body measurements.
      const owns =
        ((order as any).items || []).some(
          (i: any) => String(i.business) === bid,
        ) ||
        ((order as any).shipments || []).some(
          (s: any) =>
            String(s.business) === bid &&
            s.shipment_type === ShipmentType.VENDOR_TO_CUSTOMER,
        );
      if (!owns) {
        throw new ForbiddenException(
          'This order does not belong to your business.',
        );
      }
    }

    const user = await this.userModel
      .findById((order as any).customer)
      .select('full_name measurementSets')
      .lean();
    if (!user) throw new NotFoundException('Customer not found');

    const sets = (user as any).measurementSets || [];
    const active = sets.find((s: any) => s.active) || sets[0] || null;
    if (!active) return { data: null };

    return {
      data: {
        full_name: (user as any).full_name,
        name: active.name,
        unit: active.unit,
        active: !!active.active,
        // Embedded sets only carry createdAt; expose it as updatedAt for the UI.
        updatedAt: active.updatedAt ?? active.createdAt ?? null,
        measurements: active.measurements || {},
      },
    };
  }

  // ─── Bespoke production checklist (on the vendor's shipment) ─────────
  private readonly productionStepDefs = [
    { key: 'fabric_cut', label: 'Fabric Cut', description: 'Pattern traced and fabric cut to spec' },
    { key: 'sewing', label: 'Sewing', description: 'Garment assembled from the cut pieces' },
    { key: 'finishing', label: 'Finishing', description: 'Hems, fastenings and final touches' },
    { key: 'quality_check', label: 'Quality Check', description: 'Inspected against the measurements and spec' },
  ];

  private buildProduction(shipment: any) {
    const saved: any[] = shipment?.production_steps || [];
    const byKey = new Map(saved.map((s) => [s.key, s]));
    const steps = this.productionStepDefs.map((def) => {
      const s: any = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        completed: !!s?.completed,
        completed_at: s?.completed_at ?? null,
      };
    });
    const completed_count = steps.filter((s) => s.completed).length;
    return {
      steps,
      completed_count,
      total_count: steps.length,
      ready_to_ship: !!shipment?.ready_to_ship_at,
      ready_to_ship_at: shipment?.ready_to_ship_at ?? null,
    };
  }

  // The vendor's own garment shipment (vendor_to_customer). Scoped to the
  // business for vendor calls; admin gets the garment shipment unscoped.
  private resolveProductionShipmentIndex(
    order: any,
    scopeBusinessId?: string,
  ): number {
    const shipments: any[] = order.shipments || [];
    if (scopeBusinessId) {
      const bid = String(scopeBusinessId);
      let idx = shipments.findIndex(
        (s) =>
          String(s.business) === bid &&
          s.shipment_type === ShipmentType.VENDOR_TO_CUSTOMER,
      );
      // Fall back to any of the vendor's own shipments — but NEVER a
      // fabric_transfer. A fabric vendor doesn't run the garment's production, so
      // resolving into it would (harmlessly) expose/allow writing a checklist
      // that isn't theirs. Returning -1 makes the caller respond Forbidden.
      if (idx === -1)
        idx = shipments.findIndex(
          (s) =>
            String(s.business) === bid &&
            s.shipment_type !== ShipmentType.FABRIC_TRANSFER,
        );
      return idx;
    }
    let idx = shipments.findIndex(
      (s) => s.shipment_type === ShipmentType.VENDOR_TO_CUSTOMER,
    );
    if (idx === -1 && shipments.length) idx = 0;
    return idx;
  }

  async getOrderProduction(reference: string, scopeBusinessId?: string) {
    const order = await this.orderModel.findOne({ reference });
    if (!order) throw new NotFoundException('Order not found');
    const idx = this.resolveProductionShipmentIndex(order, scopeBusinessId);
    if (idx === -1) {
      throw scopeBusinessId
        ? new ForbiddenException('This order does not belong to your business.')
        : new NotFoundException('No shipment found on this order.');
    }
    return { data: this.buildProduction(order.shipments[idx]) };
  }

  async updateProductionStep(
    reference: string,
    businessId: string,
    step: string,
    completed: boolean,
  ) {
    const validKeys = this.productionStepDefs.map((s) => s.key);
    if (!validKeys.includes(step)) {
      throw new BadRequestException(
        `Invalid step "${step}". Expected one of: ${validKeys.join(', ')}.`,
      );
    }
    const order = await this.orderModel.findOne({ reference });
    if (!order) throw new NotFoundException('Order not found');
    const idx = this.resolveProductionShipmentIndex(order, businessId);
    if (idx === -1) {
      throw new ForbiddenException('This order does not belong to your business.');
    }
    const shipment: any = order.shipments[idx];
    if (!Array.isArray(shipment.production_steps)) shipment.production_steps = [];
    let s = shipment.production_steps.find((x: any) => x.key === step);
    if (!s) {
      s = { key: step, completed: false, completed_at: null };
      shipment.production_steps.push(s);
    }
    s.completed = !!completed;
    s.completed_at = completed ? new Date() : null;
    order.markModified('shipments');
    await order.save();
    return { data: this.buildProduction(shipment) };
  }

  async markProductionReadyToShip(reference: string, businessId: string) {
    const order = await this.orderModel.findOne({ reference });
    if (!order) throw new NotFoundException('Order not found');
    const idx = this.resolveProductionShipmentIndex(order, businessId);
    if (idx === -1) {
      throw new ForbiddenException('This order does not belong to your business.');
    }
    const shipment: any = order.shipments[idx];
    const production = this.buildProduction(shipment);
    if (production.completed_count < production.total_count) {
      throw new BadRequestException(
        `Complete all ${production.total_count} production steps before marking ready to ship ` +
          `(${production.completed_count}/${production.total_count} done).`,
      );
    }
    if (!shipment.ready_to_ship_at) shipment.ready_to_ship_at = new Date();
    if (shipment.status === ShipmentStatus.PENDING) {
      shipment.status = ShipmentStatus.READY_TO_SHIP;
    }
    order.markModified('shipments');
    await order.save();
    return { data: this.buildProduction(shipment) };
  }

  // Vendor flags a measurement problem on an order → files a dispute
  // (reason=measurement_issue, initiated_by=vendor) so it lands on /disputes/admin.
  async flagMeasurement(
    reference: string,
    businessId: string,
    dto: { reason?: string; body_part?: string },
  ) {
    const order = await this.orderModel
      .findOne({ reference })
      .select('customer items shipments reference')
      .lean();
    if (!order) throw new NotFoundException('Order not found');

    const bid = String(businessId);
    const owns =
      ((order as any).shipments || []).some(
        (s: any) => String(s.business) === bid,
      ) ||
      ((order as any).items || []).some((i: any) => String(i.business) === bid);
    if (!owns) {
      throw new ForbiddenException('This order does not belong to your business.');
    }

    const reason = (dto.reason || '').trim();
    const bodyPart = (dto.body_part || '').trim();
    if (!reason) throw new BadRequestException('A reason is required.');

    const dispute = await this.disputeModel.create({
      order: (order as any)._id,
      order_reference: (order as any).reference,
      customer: (order as any).customer,
      business: new Types.ObjectId(bid),
      reason: 'measurement_issue',
      description: bodyPart
        ? `Measurement flag — ${bodyPart}: ${reason}`
        : `Measurement flag: ${reason}`,
      body_part: bodyPart || null,
      initiated_by: 'vendor',
      status: 'open',
    });

    return {
      message: 'Measurement issue flagged for admin review.',
      data: dispute,
    };
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
        // Enough of the product to render the customer's order list/detail:
        // kind + type drive the item's product-type badge, and the kind-specific
        // name/images give the title and thumbnail.
        // Enough of the product to render the customer's order list/detail:
        // kind + type drive the item's product-type badge, the kind-specific
        // name/images give the title/thumbnail, and — for customize clothing —
        // the embedded styles/fabrics/accessories let us resolve the item's
        // design choices to a name + image (the selection ids point into these
        // embedded arrays, NOT standalone Style/Fabric/Accessory collections).
        .populate(
          'items.product',
          'kind base_price clothing.name clothing.type clothing.images ' +
            // Include the subdoc _id explicitly — dot-notation subfield
            // projection on an array does NOT auto-include the embedded _id,
            // and the client matches selection ids against it.
            'clothing.styles._id clothing.styles.name clothing.styles.images ' +
            'clothing.fabrics._id clothing.fabrics.name clothing.fabrics.images ' +
            'clothing.accessories._id clothing.accessories.name clothing.accessories.images ' +
            'accessory.name accessory.images fabric.name fabric.images',
        )
        .populate('items.business', 'business_name business_logo_url')
        .populate('customer', 'firstName lastName email')
        // Bespoke orders have no catalog product — bring the design so the
        // customer's order shows the outfit name + image.
        .populate(
          'bespoke_design',
          'name category gender design_images reference_images description',
        )
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
    const order = await this.orderModel.findOne({ reference });
    if (!order) throw new BadRequestException('Order not found');

    // Prevent cancelling already cancelled or completed orders
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    // Find the original payment transaction
    const transaction = await this.transactionService.findByOrderId(
      order._id.toString(),
    );
    if (!transaction) {
      throw new BadRequestException(
        'No payment transaction found for this order. Manual refund required.',
      );
    }

    // Route refund based on payment channel
    if (transaction.channel === 'wallet_checkout') {
      // Wallet refund: credit customer wallet back
      const walletId = transaction.wallet?.toString();
      if (walletId) {
        await this.walletsService.creditWallet(walletId, transaction.amount);

        // Create refund transaction record
        await this.transactionService.create({
          initiator: order.customer,
          order: order._id as Types.ObjectId,
          wallet: transaction.wallet,
          type: TransactionType.REFUND,
          amount: transaction.amount,
          status: TransactionStatus.SUCCESS,
          description: `Full refund for cancelled order ${order.reference}`,
          channel: 'refund',
          metadata: {
            order_reference: order.reference,
            original_transaction: transaction.reference,
            refund_type: 'wallet',
            reason: 'order_cancelled',
          },
        });

        this.logger.log(
          `[Cancel] Wallet refund of ₦${transaction.amount} processed for order ${order.reference}`,
        );
      }
    } else if (transaction.channel === 'checkout') {
      // Paystack payment → refund to the customer's WALLET (instant, in-app and
      // re-spendable) rather than a card refund via the Paystack /refund API.
      const wallet = await this.walletsService.getOrCreateWallet({
        customer: order.customer.toString(),
      });
      const walletId = (wallet._id as any).toString();
      await this.walletsService.creditWallet(walletId, transaction.amount);
      await this.transactionService.create({
        initiator: order.customer,
        order: order._id as Types.ObjectId,
        wallet: wallet._id as any,
        type: TransactionType.REFUND,
        amount: transaction.amount,
        status: TransactionStatus.SUCCESS,
        description: `Full refund for cancelled order ${order.reference}`,
        channel: 'refund',
        metadata: {
          order_reference: order.reference,
          original_transaction: transaction.reference,
          refund_type: 'wallet_from_paystack',
          reason: 'order_cancelled',
        },
      });
      this.logger.log(
        `[Cancel] ₦${transaction.amount} credited to the customer's wallet for paystack order ${order.reference}`,
      );
    } else {
      this.logger.warn(
        `[Cancel] Unknown payment channel "${transaction.channel}" for order ${order.reference}. Manual refund required.`,
      );
    }

    // Cancel the order
    order.status = OrderStatus.CANCELLED;
    (order as any).refund_status = 'refunded';
    await order.save();

    // Reverse business earnings (prevent vendor from getting paid)
    await this.reverseBusinessEarnings(order);

    // Restore inventory
    try {
      await this.productService.restoreInventory(
        order._id as Types.ObjectId,
      );
    } catch (err) {
      this.logger.error(
        `[Cancel] Failed to restore inventory for order ${order.reference}: ${err.message}`,
      );
    }

    // Notify vendor(s) about cancellation
    this.notifyVendorsOrderCancelled(order).catch((err) =>
      this.logger.error('Failed to send cancellation notifications', err),
    );

    return {
      message: 'Order cancelled and refunded successfully',
      data: { order_reference: order.reference, status: order.status },
    };
  }

  /**
   * Reverses BusinessEarning records for a cancelled/refunded order.
   * If businessId is provided, only reverses earnings for that specific vendor.
   * Handles both unreleased (delete) and already-released (claw back from wallet) earnings.
   */
  private async reverseBusinessEarnings(
    order: OrderDocument,
    businessId?: string,
  ) {
    const filter: any = { order: order._id };
    if (businessId) filter.business = new Types.ObjectId(businessId);

    // Handle unreleased earnings — delete them and decrement pending_balance
    const unreleasedEarnings = await this.businessEarningsModel.find({
      ...filter,
      released: false,
    });

    for (const earning of unreleasedEarnings) {
      this.logger.log(
        `[EarningsReversal] Reversing unreleased ₦${earning.net_amount} for business ${earning.business} on order ${order.reference}`,
      );

      // These funds were added to the vendor wallet's pending_balance when the
      // earning was recorded — remove them so the ledger stays in sync.
      await this.walletsService.reconcileBusinessWallet(earning.business, {
        pending: -(earning.net_amount || 0),
      });

      await this.businessEarningsModel.deleteOne({ _id: earning._id });
    }

    // Handle already-released earnings — claw back from wallet
    const releasedEarnings = await this.businessEarningsModel.find({
      ...filter,
      released: true,
    });

    for (const earning of releasedEarnings) {
      this.logger.warn(
        `[EarningsReversal] Clawing back already-released ₦${earning.net_amount} from business ${earning.business} on order ${order.reference}`,
      );

      // The money already moved into the vendor wallet's spendable balance,
      // so it must be removed from balance (not pending) to actually claw back.
      const clawedAmount = earning.net_amount || 0;
      const vendorWallet = await this.walletsService.reconcileBusinessWallet(
        earning.business,
        { balance: -clawedAmount },
      );

      // Mirror the claw-back in the vendor ledger as a REFUND debit so their
      // transaction history stays consistent with their wallet balance (the
      // release earlier wrote a matching CREDIT).
      if (vendorWallet && clawedAmount > 0) {
        await this.transactionService.create({
          wallet: vendorWallet._id as any,
          order: order._id as any,
          type: TransactionType.REFUND,
          amount: clawedAmount,
          status: TransactionStatus.SUCCESS,
          channel: 'refund',
          payment_method: 'wallet',
          description: `Earnings reversed for order ${order.reference}`,
          metadata: {
            earning_id: (earning._id as any).toString(),
            business_id: (earning.business as any)?.toString?.() ?? earning.business,
            clawback: true,
          },
        });
      }

      // Mark the earning as reversed. Keep released=true so the release cron
      // does not re-pick it (release_date is already in the past).
      earning.net_amount = 0;
      await earning.save();
    }

    // Reset order-level earnings fields
    if (!businessId) {
      await this.orderModel.updateOne(
        { _id: order._id },
        { $set: { vendor_earnings: 0, platform_commission: 0 } },
      );
    }
  }


  /**
   * Vendor confirms their portion of the order.
   * Only when ALL vendors confirm → order moves to "processing".
   */
  async confirmVendorShipment(
    orderReference: string,
    business: Business | BusinessDocument,
  ) {
    const businessId = (business._id || (business as any).id).toString();

    const order = await this.orderModel.findOne({ reference: orderReference });
    if (!order) throw new BadRequestException('Order not found');

    const shipment = order.shipments.find(
      (s) => s.business.toString() === businessId,
    );
    if (!shipment) {
      throw new BadRequestException('No shipment found for your business in this order');
    }
    if (shipment.confirmed) {
      throw new BadRequestException('You have already confirmed this shipment');
    }
    if (shipment.rejected) {
      throw new BadRequestException('This shipment has been rejected and cannot be confirmed');
    }

    // Mark this vendor's shipment as confirmed
    shipment.confirmed = true;
    shipment.confirmed_at = new Date();

    // Calculate fulfillment deadline based on product turnaround_days
    const DEFAULT_TURNAROUND_DAYS = 3; // For fabrics/accessories
    const vendorItems = order.items.filter(
      (i) => i.business?.toString() === businessId,
    );
    const productIds = vendorItems.map((i) => i.product);
    const products = await this.productModel.find({ _id: { $in: productIds } }).lean();

    let maxTurnaroundDays = DEFAULT_TURNAROUND_DAYS;
    for (const product of products) {
      const turnaround = (product as any).clothing?.turnaround_days ?? DEFAULT_TURNAROUND_DAYS;
      if (turnaround > maxTurnaroundDays) {
        maxTurnaroundDays = turnaround;
      }
    }

    const deadline = new Date(shipment.confirmed_at);
    deadline.setDate(deadline.getDate() + maxTurnaroundDays);
    shipment.fulfillment_deadline = deadline;

    this.logger.log(
      `[Confirm] Fulfillment deadline set to ${deadline.toISOString()} (${maxTurnaroundDays} days) for vendor ${businessId} on order ${orderReference}`,
    );

    // Check if ALL non-rejected shipments are confirmed
    const activeShipments = order.shipments.filter((s) => !s.rejected);
    const allConfirmed = activeShipments.every((s) => s.confirmed);

    if (allConfirmed) {
      order.status = OrderStatus.PROCESSING;
    }

    await order.save();

    // Schedule the upfront milestone for this vendor (custom orders only).
    // Apply the same payout delay as completion rather than releasing the
    // instant the vendor clicks confirm — this keeps the money in
    // pending_balance during a claw-back window, so a confirm-then-cancel can
    // be reversed cleanly before the vendor can withdraw it. The upfront still
    // lands well before delivery (funding materials), just not instantly.
    const settings = await this.platformSettingsModel.findOne().lean();
    const payoutDelayDays = (settings as any)?.payout_delay_days ?? 3;
    const upfrontReleaseDate = new Date(
      Date.now() + payoutDelayDays * 24 * 60 * 60 * 1000,
    );
    const upfrontResult = await this.businessEarningsModel.updateMany(
      {
        order: order._id,
        business: businessId,
        milestone: 'upfront',
        released: false,
        release_date: null,
      },
      { $set: { release_date: upfrontReleaseDate } },
    );

    if (upfrontResult.modifiedCount > 0) {
      this.logger.log(
        `[Milestone] Scheduled ${upfrontResult.modifiedCount} upfront earning(s) for vendor ${businessId} on order ${orderReference} — releasing ${upfrontReleaseDate.toISOString()}`,
      );
    }

    // Notify customer that this vendor confirmed
    this.notifyCustomerVendorConfirmed(order, business).catch((err) =>
      this.logger.error('Failed to send vendor confirmation notification', err),
    );

    return {
      message: `Shipment confirmed by ${(business as any).business_name || businessId}`,
      data: {
        confirmed: true,
        all_vendors_confirmed: allConfirmed,
        order_status: order.status,
      },
    };
  }

  /**
   * Vendor rejects their portion of the order.
   * Refunds only this vendor's items + shipping to the customer.
   */
  async rejectVendorShipment(
    orderReference: string,
    business: Business | BusinessDocument,
    reason?: string,
  ) {
    const businessId = (business._id || (business as any).id).toString();

    const order = await this.orderModel.findOne({ reference: orderReference });
    if (!order) throw new BadRequestException('Order not found');

    const shipment = order.shipments.find(
      (s) => s.business.toString() === businessId,
    );
    if (!shipment) {
      throw new BadRequestException('No shipment found for your business in this order');
    }
    if (shipment.rejected) {
      throw new BadRequestException('This shipment has already been rejected');
    }
    if (shipment.status === ShipmentStatus.SHIPPED || shipment.status === ShipmentStatus.IN_TRANSIT) {
      throw new BadRequestException('Cannot reject a shipment that has already been shipped');
    }

    // Mark as rejected
    shipment.rejected = true;
    shipment.rejected_at = new Date();
    shipment.rejection_reason = reason || 'Vendor declined the order';
    shipment.status = ShipmentStatus.FAILED;

    // Calculate refund amount for this vendor's portion
    const vendorItems = order.items.filter(
      (i) => i.business?.toString() === businessId,
    );
    const vendorItemsTotal = vendorItems.reduce(
      (sum, item) => sum + (item.total_price || 0),
      0,
    );
    const vendorShippingFee = shipment.shipping_fee || 0;
    const refundAmount = vendorItemsTotal + vendorShippingFee;

    // Update order totals
    order.subtotal = Math.max(0, (order.subtotal || 0) - vendorItemsTotal);
    order.shipping_fee = Math.max(0, (order.shipping_fee || 0) - vendorShippingFee);
    order.total = Math.max(0, (order.total || 0) - refundAmount);

    // Check if ALL shipments are now rejected → cancel entire order
    const allRejected = order.shipments.every((s) => s.rejected);
    if (allRejected) {
      order.status = OrderStatus.CANCELLED;
    } else {
      // Check if remaining (non-rejected) shipments are all confirmed → processing
      const activeShipments = order.shipments.filter((s) => !s.rejected);
      const allConfirmed = activeShipments.every((s) => s.confirmed);
      if (allConfirmed) {
        order.status = OrderStatus.PROCESSING;
      }
    }

    await order.save();

    // Issue partial refund
    this.processPartialRefund(order, refundAmount, `Vendor ${businessId} rejected`).catch((err) =>
      this.logger.error(`Failed to process partial refund for order ${orderReference}: ${err.message}`),
    );

    // Reverse business earnings for the rejecting vendor
    this.reverseBusinessEarnings(order, businessId).catch((err) =>
      this.logger.error(`Failed to reverse earnings for vendor ${businessId} on order ${orderReference}: ${err.message}`),
    );

    // Return the rejected vendor's items to stock — they were deducted at
    // payment. Best-effort so a restock hiccup can't fail the rejection.
    this.productService
      .restoreInventory(order._id as Types.ObjectId, businessId)
      .catch((err) =>
        this.logger.error(
          `Failed to restore inventory for rejected vendor ${businessId} on order ${orderReference}: ${err.message}`,
        ),
      );

    // Notify customer about rejection
    this.notifyCustomerVendorRejected(order, business, reason).catch((err) =>
      this.logger.error('Failed to send vendor rejection notification', err),
    );

    return {
      message: `Shipment rejected. ₦${refundAmount.toLocaleString()} will be refunded to the customer.`,
      data: {
        rejected: true,
        refund_amount: refundAmount,
        order_status: order.status,
      },
    };
  }

  /**
   * Notify customer that a vendor has confirmed their order portion.
   */
  private async notifyCustomerVendorConfirmed(order: OrderDocument, business: Business | BusinessDocument) {
    const businessName = (business as any).business_name || 'A vendor';
    await this.notificationsService.create({
      recipient: order.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Order Confirmed by Vendor',
      body: `${businessName} has confirmed your order #${order.reference}. They're getting it ready!`,
      metadata: {
        order_id: order._id,
        order_reference: order.reference,
        business_name: businessName,
      },
      action_url: `/orders`,
    });
  }

  /**
   * Notify customer that a vendor has rejected their order portion.
   */
  private async notifyCustomerVendorRejected(order: OrderDocument, business: Business | BusinessDocument, reason?: string) {
    const businessName = (business as any).business_name || 'A vendor';
    await this.notificationsService.create({
      recipient: order.customer.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Vendor Declined Order',
      body: `${businessName} was unable to fulfill their portion of order #${order.reference}.${reason ? ` Reason: ${reason}` : ''} A refund for their items will be processed.`,
      metadata: {
        order_id: order._id,
        order_reference: order.reference,
        business_name: businessName,
        reason,
      },
      action_url: `/orders`,
    });
  }

  // ==================== PARTIAL REFUND ====================

  /**
   * Process a partial refund for a rejected vendor shipment.
   * Detects whether the original payment was Paystack or wallet, and routes accordingly.
   */
  /**
   * Refund `refundAmount` to the customer for a partially-refunded order.
   *
   * Always leaves an audit trail: a REFUND transaction is written on every
   * attempt — `success` when the money actually reached the customer's wallet /
   * card, `failed` (with a failure reason in metadata) when it didn't — so a
   * penalty debited from a vendor can never silently vanish with nothing on the
   * customer side. Returns whether the credit landed so callers can decide
   * whether to tell the customer they were compensated.
   */
  private async processPartialRefund(
    order: OrderDocument,
    refundAmount: number,
    reason: string,
  ): Promise<{ success: boolean; reason?: string }> {
    if (refundAmount <= 0) return { success: false, reason: 'non_positive_amount' };

    const orderId = order._id.toString();
    const customerId = order.customer?.toString();

    this.logger.log(
      `[Refund] Processing ₦${refundAmount} refund for order ${order.reference}. Reason: ${reason}`,
    );

    // Write a REFUND ledger row for this attempt (never throws).
    const recordRefund = async (
      status: TransactionStatus,
      extra: Record<string, any>,
      walletId?: string,
    ) => {
      try {
        await this.transactionService.create({
          initiator: customerId ? new Types.ObjectId(customerId) : undefined,
          order: order._id as Types.ObjectId,
          wallet: walletId ? new Types.ObjectId(walletId) : undefined,
          type: TransactionType.REFUND,
          amount: refundAmount,
          status,
          description: `Partial refund for order ${order.reference}: ${reason}`,
          channel: 'refund',
          metadata: { order_reference: order.reference, reason, ...extra },
        });
      } catch (err) {
        this.logger.error(
          `[Refund] Failed to write refund transaction for order ${order.reference}: ${err.message}`,
        );
      }
    };

    const markOrderPartiallyRefunded = () =>
      this.orderModel.updateOne(
        { _id: orderId, refund_status: { $ne: 'refunded' } },
        { refund_status: 'partial' },
      );

    // Find the original payment transaction for this order
    const originalTransaction = await this.transactionService.findByOrderId(orderId);

    if (!originalTransaction) {
      this.logger.error(
        `[Refund] No original transaction found for order ${order.reference}. Manual refund required.`,
      );
      await recordRefund(TransactionStatus.FAILED, {
        refund_type: 'manual',
        failure: 'original_transaction_not_found',
      });
      return { success: false, reason: 'original_transaction_not_found' };
    }

    const paymentChannel = originalTransaction.channel;

    // Route based on payment method
    if (paymentChannel === 'wallet_checkout') {
      // Wallet payment → credit the customer's wallet back
      const walletId = originalTransaction.wallet?.toString();

      if (!walletId) {
        this.logger.error(
          `[Refund] No wallet ID found on transaction for order ${order.reference}`,
        );
        await recordRefund(TransactionStatus.FAILED, {
          refund_type: 'wallet',
          original_transaction: originalTransaction.reference,
          failure: 'wallet_id_missing',
        });
        return { success: false, reason: 'wallet_id_missing' };
      }

      try {
        await this.walletsService.creditWallet(walletId, refundAmount);
        await recordRefund(
          TransactionStatus.SUCCESS,
          {
            original_transaction: originalTransaction.reference,
            refund_type: 'wallet',
          },
          walletId,
        );
        await markOrderPartiallyRefunded();
        this.logger.log(
          `[Refund] ₦${refundAmount} credited back to wallet ${walletId} for order ${order.reference}`,
        );
        return { success: true };
      } catch (error) {
        this.logger.error(
          `[Refund] Failed to credit wallet for order ${order.reference}: ${error.message}`,
          error.stack,
        );
        await recordRefund(
          TransactionStatus.FAILED,
          {
            original_transaction: originalTransaction.reference,
            refund_type: 'wallet',
            failure: 'wallet_credit_error',
          },
          walletId,
        );
        return { success: false, reason: 'wallet_credit_error' };
      }
    } else if (paymentChannel === 'checkout') {
      // Paystack payment → refund to the customer's WALLET (instant, stays in
      // the app and is immediately re-spendable) rather than a card refund via
      // the Paystack /refund API (slow, and silently unavailable in test mode —
      // which is why these refunds often never appeared to land).
      if (!customerId) {
        await recordRefund(TransactionStatus.FAILED, {
          original_transaction: originalTransaction.reference,
          refund_type: 'wallet_from_paystack',
          failure: 'customer_missing',
        });
        return { success: false, reason: 'customer_missing' };
      }
      try {
        const wallet = await this.walletsService.getOrCreateWallet({
          customer: customerId,
        });
        const walletId = (wallet._id as any).toString();
        await this.walletsService.creditWallet(walletId, refundAmount);
        await recordRefund(
          TransactionStatus.SUCCESS,
          {
            original_transaction: originalTransaction.reference,
            refund_type: 'wallet_from_paystack',
          },
          walletId,
        );
        await markOrderPartiallyRefunded();
        this.logger.log(
          `[Refund] ₦${refundAmount} credited to the customer's wallet for paystack order ${order.reference}`,
        );
        return { success: true };
      } catch (error: any) {
        this.logger.error(
          `[Refund] Failed to credit customer wallet for paystack order ${order.reference}: ${error.message}`,
          error.stack,
        );
        await recordRefund(TransactionStatus.FAILED, {
          original_transaction: originalTransaction.reference,
          refund_type: 'wallet_from_paystack',
          failure: 'wallet_credit_error',
        });
        return { success: false, reason: 'wallet_credit_error' };
      }
    }

    this.logger.warn(
      `[Refund] Unknown payment channel "${paymentChannel}" for order ${order.reference}. Manual refund required.`,
    );
    await recordRefund(TransactionStatus.FAILED, {
      refund_type: 'manual',
      failure: `unknown_channel_${paymentChannel}`,
    });
    return { success: false, reason: 'unknown_channel' };
  }

  // ==================== CRON: 24h Auto-Reject ====================

  /**
   * Runs every hour. Finds orders in 'in_review' with unconfirmed shipments
   * older than 24 hours, and auto-rejects those vendor shipments.
   */
  @Cron('0 * * * *', { timeZone: 'Africa/Lagos' }) // Every hour
  async autoRejectStaleShipments() {
    try {
      const settings = await this.platformSettingsModel.findOne().lean();
      const autoRejectHours = (settings as any)?.auto_reject_hours ?? 24;
      const STALE_THRESHOLD_MS = autoRejectHours * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

      // Find orders that are in_review and were created more than 24h ago
      const staleOrders = await this.orderModel.find({
        status: OrderStatus.IN_REVIEW,
        createdAt: { $lte: cutoff },
      });

      if (staleOrders.length === 0) return;

      this.logger.log(
        `[AutoReject] Found ${staleOrders.length} order(s) with stale shipments`,
      );

      for (const order of staleOrders) {
        let orderChanged = false;

        for (const shipment of order.shipments) {
          // Skip already confirmed or rejected shipments
          if (shipment.confirmed || shipment.rejected) continue;

          // Auto-reject this vendor's unconfirmed shipment
          shipment.rejected = true;
          shipment.rejected_at = new Date();
          shipment.rejection_reason = 'Auto-rejected: vendor did not confirm within 24 hours';
          shipment.status = ShipmentStatus.FAILED;
          orderChanged = true;

          // Calculate refund for this vendor's portion
          const vendorItems = order.items.filter(
            (i) => i.business?.toString() === shipment.business.toString(),
          );
          const vendorItemsTotal = vendorItems.reduce(
            (sum, item) => sum + ((item as any).total_price || 0),
            0,
          );
          const vendorShippingFee = shipment.shipping_fee || 0;
          const refundAmount = vendorItemsTotal + vendorShippingFee;

          // Update order totals
          order.subtotal = Math.max(0, (order.subtotal || 0) - vendorItemsTotal);
          order.shipping_fee = Math.max(0, (order.shipping_fee || 0) - vendorShippingFee);
          order.total = Math.max(0, (order.total || 0) - refundAmount);

          // Look up vendor name for notification
          const business = await this.businessModel.findById(shipment.business);
          const businessName = business?.business_name || 'A vendor';

          this.logger.log(
            `[AutoReject] Auto-rejected shipment for ${businessName} on order ${order.reference}. Refund: ₦${refundAmount}`,
          );

          // Atomically CLAIM this shipment's refund before issuing it. The cron
          // is not single-flight (two backend instances, or overlapping runs,
          // both load the same IN_REVIEW orders), so without this both would
          // refund the customer and reverse earnings twice. Only the instance
          // whose $set actually flips `refunded` (modifiedCount === 1) proceeds;
          // the loser's later order.save() only $sets its own modified paths, so
          // it won't reset this flag.
          const refundClaim = await this.orderModel.updateOne(
            {
              _id: order._id,
              shipments: {
                $elemMatch: {
                  _id: (shipment as any)._id,
                  refunded: { $ne: true },
                },
              },
            },
            { $set: { 'shipments.$.refunded': true } },
          );

          if (refundClaim.modifiedCount === 1) {
            (shipment as any).refunded = true; // keep the in-memory doc in sync

            // Process partial refund
            this.processPartialRefund(
              order as OrderDocument,
              refundAmount,
              `Auto-rejected: ${businessName} did not confirm within 24h`,
            ).catch((err) =>
              this.logger.error(`[AutoReject] Refund failed for ${order.reference}: ${err.message}`),
            );

            // Reverse business earnings for the auto-rejected vendor
            this.reverseBusinessEarnings(
              order as OrderDocument,
              shipment.business.toString(),
            ).catch((err) =>
              this.logger.error(`[AutoReject] Earnings reversal failed for ${order.reference}: ${err.message}`),
            );

            // Return this vendor's items to stock (deducted at payment).
            this.productService
              .restoreInventory(
                order._id as Types.ObjectId,
                shipment.business.toString(),
              )
              .catch((err) =>
                this.logger.error(
                  `[AutoReject] Inventory restore failed for ${order.reference}: ${err.message}`,
                ),
              );
          } else {
            this.logger.warn(
              `[AutoReject] Refund for order ${order.reference} shipment ${(shipment as any)._id} already claimed — skipping to avoid a duplicate.`,
            );
          }

          // Notify customer
          this.notificationsService.create({
            recipient: order.customer.toString(),
            category: NotificationCategory.ORDER,
            type: NotificationType.ORDER_CANCELLED,
            title: 'Vendor Did Not Respond',
            body: `${businessName} did not confirm your order #${order.reference} within 24 hours. A refund of ₦${refundAmount.toLocaleString()} for their items will be processed.`,
            metadata: {
              order_id: order._id,
              order_reference: order.reference,
              business_name: businessName,
              refund_amount: refundAmount,
              reason: 'auto_reject_24h',
            },
            action_url: `/orders`,
          }).catch((err) =>
            this.logger.error(`[AutoReject] Failed to notify customer: ${err.message}`),
          );
        }

        if (orderChanged) {
          // Check if ALL shipments are now rejected → cancel entire order
          const allRejected = order.shipments.every((s) => s.rejected);
          if (allRejected) {
            order.status = OrderStatus.CANCELLED;
          } else {
            // Check if remaining are all confirmed → processing
            const activeShipments = order.shipments.filter((s) => !s.rejected);
            const allConfirmed = activeShipments.every((s) => s.confirmed);
            if (allConfirmed) {
              order.status = OrderStatus.PROCESSING;
            }
          }

          await order.save();
        }
      }

      this.logger.log(`[AutoReject] Finished processing ${staleOrders.length} stale order(s)`);
    } catch (error) {
      this.logger.error(`[AutoReject] Cron failed: ${error.message}`, error.stack);
    }
  }

  // ==================== CRON: Late Fulfillment Penalty ====================

  /**
   * Runs every hour. Finds confirmed-but-unfulfilled vendor shipments
   * that have passed their fulfillment_deadline, and applies a progressive
   * penalty: 5% of vendor items total per day late, capped at 25%.
   * The penalty is deducted from vendor earnings and refunded to the customer.
   */
  @Cron('30 * * * *', { timeZone: 'Africa/Lagos' }) // Every hour at :30
  async checkLateFulfillments() {
    try {
      const settings = await this.platformSettingsModel.findOne().lean();
      const PENALTY_PERCENT_PER_DAY = (settings as any)?.late_penalty_percent_per_day ?? 5;
      const MAX_PENALTY_PERCENT = (settings as any)?.late_penalty_max_percent ?? 25;

      // Find orders with confirmed shipments that have a deadline in the past
      const orders = await this.orderModel.find({
        status: { $in: [OrderStatus.PROCESSING, OrderStatus.IN_REVIEW] },
        'shipments.confirmed': true,
        'shipments.fulfillment_deadline': { $lte: new Date() },
      });

      if (orders.length === 0) return;

      this.logger.log(
        `[LatePenalty] Checking ${orders.length} order(s) for overdue shipments`,
      );

      for (const order of orders) {
        for (const shipment of order.shipments) {
          // Skip shipments that aren't overdue or are already shipped/rejected
          if (!shipment.confirmed || shipment.rejected) continue;
          if (!shipment.fulfillment_deadline) continue;
          if (
            shipment.status === ShipmentStatus.SHIPPED ||
            shipment.status === ShipmentStatus.IN_TRANSIT ||
            shipment.status === ShipmentStatus.DELIVERED
          ) continue;

          const now = new Date();
          if (now <= shipment.fulfillment_deadline) continue;

          // Calculate days late
          const msLate = now.getTime() - shipment.fulfillment_deadline.getTime();
          const daysLate = Math.ceil(msLate / (24 * 60 * 60 * 1000));

          // Skip if we've already penalized for this many (or more) days
          if (daysLate <= (shipment.late_penalty_days || 0)) continue;

          const businessId = shipment.business.toString();

          // Calculate vendor items total
          const vendorItems = order.items.filter(
            (i) => i.business?.toString() === businessId,
          );
          const vendorItemsTotal = vendorItems.reduce(
            (sum, item) => sum + ((item as any).total_price || 0),
            0,
          );

          if (vendorItemsTotal <= 0) continue;

          // Calculate total penalty (cumulative)
          const penaltyPercent = Math.min(daysLate * PENALTY_PERCENT_PER_DAY, MAX_PENALTY_PERCENT);
          const totalPenaltyAmount = Math.round(vendorItemsTotal * (penaltyPercent / 100));

          // Calculate incremental penalty (what hasn't been applied yet)
          const previouslyApplied = shipment.late_penalty_amount || 0;
          const incrementalPenalty = totalPenaltyAmount - previouslyApplied;

          if (incrementalPenalty <= 0) continue;

          // Look up vendor name
          const business = await this.businessModel.findById(businessId);
          const businessName = business?.business_name || 'A vendor';

          this.logger.log(
            `[LatePenalty] Vendor "${businessName}" is ${daysLate} day(s) late on order ${order.reference}. ` +
            `Applying incremental penalty of ₦${incrementalPenalty} (total: ₦${totalPenaltyAmount}, ${penaltyPercent}%)`,
          );

          // Atomically CLAIM this penalty tier before applying it. Like the
          // auto-reject cron, this runs on multiple instances / overlapping runs;
          // the in-memory `daysLate <= late_penalty_days` guard above is
          // check-then-act and lets both apply the same tier, double-penalizing
          // the vendor and double-compensating the customer. Advancing
          // late_penalty_days from < daysLate to daysLate atomically means only
          // one instance (modifiedCount === 1) proceeds to deduct + refund.
          const penaltyClaim = await this.orderModel.updateOne(
            {
              _id: order._id,
              shipments: {
                $elemMatch: {
                  _id: (shipment as any)._id,
                  late_penalty_days: { $lt: daysLate },
                },
              },
            },
            {
              $set: {
                'shipments.$.late_penalty_applied': true,
                'shipments.$.late_penalty_amount': totalPenaltyAmount,
                'shipments.$.late_penalty_days': daysLate,
              },
            },
          );
          if (penaltyClaim.modifiedCount !== 1) {
            this.logger.warn(
              `[LatePenalty] Penalty tier (${daysLate}d) for order ${order.reference} shipment ${(shipment as any)._id} already claimed — skipping to avoid a duplicate.`,
            );
            continue;
          }

          // Keep the in-memory doc in sync, then deduct from the order's recorded
          // vendor earnings (safe: only the claim winner reaches here).
          shipment.late_penalty_applied = true;
          shipment.late_penalty_amount = totalPenaltyAmount;
          shipment.late_penalty_days = daysLate;
          order.vendor_earnings = Math.max(0, (order.vendor_earnings || 0) - incrementalPenalty);

          await order.save();

          // Charge the penalty to the vendor. Take it from their UNRELEASED
          // earnings first — reduce each earning's net_amount (so the release
          // cron pays out less) and drop the matching amount from the wallet's
          // pending balance. If that isn't enough (the earnings were already
          // released into their spendable balance), claw the remainder back from
          // that balance — otherwise the vendor keeps their money while the
          // platform funds the customer's compensation. (A per-earning loop, not
          // one $inc across all records, so bespoke upfront+completion earnings
          // aren't each charged the full penalty.)
          try {
            let remaining = incrementalPenalty;
            const unreleased = await this.businessEarningsModel.find({
              order: order._id,
              business: businessId,
              released: false,
            });
            for (const earning of unreleased) {
              if (remaining <= 0) break;
              const take = Math.min(remaining, earning.net_amount || 0);
              if (take <= 0) continue;
              earning.net_amount = (earning.net_amount || 0) - take;
              await earning.save();
              await this.walletsService.reconcileBusinessWallet(businessId, {
                pending: -take,
              });
              remaining -= take;
            }
            if (remaining > 0) {
              // Already-released earnings → claw back from spendable balance.
              // reconcileBusinessWallet floors at 0, so this only recovers what
              // is still in the wallet (unrecoverable if already withdrawn).
              await this.walletsService.reconcileBusinessWallet(businessId, {
                balance: -remaining,
              });
              this.logger.warn(
                `[LatePenalty] Clawed back ₦${remaining} from ${businessName}'s released balance on order ${order.reference} (pending earnings did not cover the penalty).`,
              );
            }
          } catch (err: any) {
            this.logger.error(
              `[LatePenalty] Failed to charge penalty to vendor ${businessId}: ${err.message}`,
            );
          }

          // Refund the incremental amount to the customer, then only tell them
          // they were compensated if the credit actually landed — the vendor
          // has already been debited above, so a silently-failed refund must
          // NOT be reported to the customer as money received.
          const refundResult = await this.processPartialRefund(
            order as OrderDocument,
            incrementalPenalty,
            `Late fulfillment penalty: ${businessName} is ${daysLate} day(s) past deadline`,
          ).catch((err) => {
            this.logger.error(
              `[LatePenalty] Refund failed for order ${order.reference}: ${err.message}`,
            );
            return { success: false, reason: 'exception' as string };
          });

          if (refundResult?.success) {
            // Notify customer — only when the compensation truly reached them
            this.notificationsService.create({
              recipient: order.customer.toString(),
              category: NotificationCategory.ORDER,
              type: NotificationType.LATE_FULFILLMENT_PENALTY,
              title: 'Late Fulfillment Compensation',
              body: `${businessName} is ${daysLate} day(s) late fulfilling order #${order.reference}. A ₦${incrementalPenalty.toLocaleString()} compensation has been credited to you.`,
              metadata: {
                order_id: order._id,
                order_reference: order.reference,
                business_name: businessName,
                penalty_amount: incrementalPenalty,
                total_penalty: totalPenaltyAmount,
                days_late: daysLate,
                reason: 'late_fulfillment_penalty',
              },
              action_url: `/orders`,
            }).catch((err) =>
              this.logger.error(`[LatePenalty] Failed to notify customer: ${err.message}`),
            );
          } else {
            // Vendor was debited but the customer credit did not complete — a
            // FAILED refund transaction was recorded for reconciliation.
            this.logger.error(
              `[LatePenalty] Penalty of ₦${incrementalPenalty} applied to vendor on order ${order.reference}, ` +
              `but customer refund did NOT complete (${refundResult?.reason}). ` +
              `A failed refund transaction was recorded for manual reconciliation.`,
            );
          }

          // Notify vendor
          if (business?.created_by?.id) {
            this.notificationsService.create({
              recipient: business.created_by.id.toString(),
              category: NotificationCategory.ORDER,
              type: NotificationType.LATE_FULFILLMENT_PENALTY,
              title: 'Late Fulfillment Penalty',
              body: `You are ${daysLate} day(s) past the fulfillment deadline for order #${order.reference}. A ₦${incrementalPenalty.toLocaleString()} penalty has been applied. Please fulfill this order immediately.`,
              metadata: {
                order_id: order._id,
                order_reference: order.reference,
                penalty_amount: incrementalPenalty,
                total_penalty: totalPenaltyAmount,
                days_late: daysLate,
                max_penalty_percent: MAX_PENALTY_PERCENT,
                reason: 'late_fulfillment_penalty',
              },
              action_url: `/orders`,
            }).catch((err) =>
              this.logger.error(`[LatePenalty] Failed to notify vendor: ${err.message}`),
            );
          }
        }
      }

      this.logger.log(`[LatePenalty] Finished checking late fulfillments`);
    } catch (error) {
      this.logger.error(`[LatePenalty] Cron failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Checkout preview: split cart by vendor, fetch rates per vendor.
   * Returns per-vendor courier options for the customer to select.
   */
  /**
   * Re-check that every cart line is still purchasable against LIVE stock — a
   * product/variant can sell out (or a fabric drop below the requested yards)
   * between adding to cart and checking out. Returns the lines that are no
   * longer available so the preview can block checkout with a clear message
   * instead of failing at the deduction step (which, for wallet, rolls the
   * whole order back). Customize garments are made-to-order and never gated.
   */
  private validateCartAvailability(
    cartItems: any[],
    productMap: Map<string, any>,
  ): Array<{ product_id: string; product_name: string; reason: string }> {
    const issues: Array<{
      product_id: string;
      product_name: string;
      reason: string;
    }> = [];

    for (const cartItem of cartItems) {
      const productId =
        (cartItem.product_id as any)?._id?.toString() ??
        String(cartItem.product_id);
      const product = productMap.get(productId);
      if (!product) continue;

      const name =
        product.clothing?.name ??
        product.accessory?.name ??
        product.fabric?.name ??
        'Item';
      const sel: any = cartItem.selections || {};
      const qty = cartItem.quantity ?? 1;
      const flag = (reason: string) =>
        issues.push({ product_id: productId, product_name: name, reason });

      if (product.kind === 'clothing') {
        if (product.clothing?.type === 'customize') continue; // made to order
        const cvs = sel.color_variant_selections?.[0];
        const variantId = cvs?.color_variant_id;
        const need = cvs?.quantity ?? qty;
        if (variantId) {
          let stock: number | undefined;
          for (const cv of product.clothing?.color_variants || []) {
            const v = cv.variants?.find(
              (x: any) => String(x._id) === String(variantId),
            );
            if (v) {
              stock = v.stock ?? 0;
              break;
            }
          }
          if (stock !== undefined && stock < need) {
            flag(stock <= 0 ? 'Out of stock' : `Only ${stock} left`);
          }
        } else if (!computeAvailability(product).in_stock) {
          flag('Out of stock');
        }
      } else if (product.kind === 'fabric') {
        const fs = sel.fabric_selections?.[0];
        const reqYards = (fs?.yardage ?? 0) * (fs?.quantity ?? qty ?? 1);
        const yardLeft = product.fabric?.yard_length ?? 0;
        const minCut = product.fabric?.min_cut ?? 0;
        if (yardLeft <= 0 || yardLeft < minCut) flag('Out of stock');
        else if (reqYards > yardLeft) flag(`Only ${yardLeft} yd left`);
      } else if (product.kind === 'accessory') {
        const asSel = sel.accessory_selections?.[0];
        const variantId = asSel?.variant_id;
        const need = asSel?.quantity ?? qty;
        if (variantId) {
          const v = (product.accessory?.variants || []).find(
            (x: any) => String(x._id) === String(variantId),
          );
          if (v && (v.stock ?? 0) < need) {
            flag((v.stock ?? 0) <= 0 ? 'Out of stock' : `Only ${v.stock} left`);
          }
        } else if (!computeAvailability(product).in_stock) {
          flag('Out of stock');
        }
      }
    }

    return issues;
  }

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
        ...ObjectIdUtils.refMatch('customer', customerId),
      });
      if (!customerAddress) {
        throw new BadRequestException('Specified address not found');
      }
    } else {
      customerAddress = await this.addressModel.findOne({
        ...ObjectIdUtils.refMatch('customer', customerId),
        is_default: true,
      });
      if (!customerAddress) {
        // Fallback to any address
        customerAddress = await this.addressModel.findOne(
          ObjectIdUtils.refMatch('customer', customerId),
        );
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

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    const vendorGroups = new Map<
      string,
      {
        business: BusinessDocument;
        items: Array<{ product_id: string; product_name: string; pkg: any }>;
      }
    >();

    // Iterate the CART items (not the deduped product list) so each line's
    // selections, quantity and — for fabric — chosen yardage flow into the
    // courier manifest / vendor email.
    for (const cartItem of cart.items) {
      const productId =
        (cartItem.product_id as any)?._id?.toString() ??
        String(cartItem.product_id);
      const product = productMap.get(productId);
      if (!product) continue;

      const bizId = product.business?.toString();
      if (!bizId || !bizMap.has(bizId)) continue;

      if (!vendorGroups.has(bizId)) {
        vendorGroups.set(bizId, { business: bizMap.get(bizId)!, items: [] });
      }

      const { name } = await this.getProductDetails(product);
      const selections: any = cartItem.selections || {};
      const perUnit = await this.resolvePerUnitAmount(product, selections);
      const isFabric = product.kind === 'fabric';
      const fabricYards = selections?.fabric_selections?.[0]?.yardage;

      const pkg = this.buildManifestItem({
        name,
        kind: product.kind,
        // Fabric ships as a single cut priced at its full (yardage) value; other
        // kinds keep the real unit count with a per-unit price.
        unitAmount: perUnit,
        quantity: isFabric ? 1 : cartItem.quantity ?? 1,
        fabricYards,
        baseWeightKg: estimateProductWeightKg(product),
      });

      vendorGroups.get(bizId)!.items.push({
        product_id: String(product._id),
        product_name: name,
        pkg,
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
            package_items: group.items.map((item) => item.pkg),
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
            name: `${fabricName} — ${fabricYards} yd`,
            description: `${fabricYards} yards of ${fabricName}`,
            unit_weight: Math.max(0.1, Math.ceil(fabricYards * 0.3)), // ~0.3kg per yard
            // Declared value = yards × price_per_yard (fall back to base price).
            unit_amount:
              (fabricProduct.fabric?.price_per_yard ?? 0) * fabricYards ||
              fabricProduct.base_price ||
              0,
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

    // Re-validate stock against LIVE inventory (items can sell out between
    // add-to-cart and checkout). Non-empty → the shop blocks "Place order".
    const unavailable_items = this.validateCartAvailability(
      cart.items,
      productMap,
    );

    return {
      vendor_shipping: vendorShipping,
      fabric_transfers: fabricTransfers,
      total_shipping_fee: totalShippingFee,
      subtotal,
      total: subtotal + totalShippingFee,
      unavailable_items,
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

    // ── Gate: vendor must confirm before fulfilling ──
    const preCheck = await this.orderModel.findOne({ reference: orderReference });
    if (preCheck) {
      const myShipment = preCheck.shipments.find(
        (s) => s.business.toString() === businessId,
      );
      if (myShipment && !myShipment.confirmed) {
        throw new BadRequestException(
          'You must confirm this order before you can fulfill it. Use the confirm endpoint first.',
        );
      }
      if (myShipment?.rejected) {
        throw new BadRequestException(
          'This shipment has been rejected and cannot be fulfilled.',
        );
      }
    }

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
    if (shipmentIndex === -1) {
      throw new BadRequestException(
        'No shipment found for your business on this order. ' +
        'This usually means a shipping option was not selected at checkout, ' +
        'so there is no rate to create a label from.',
      );
    }
    const shipment = order.shipments[shipmentIndex];

    // Verify payment
    const transaction = await this.transactionService.findByOrderId(order.id);
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
          // Declared value = the line's real charged price (frozen at order
          // time); fabric yardage comes from the stored selection.
          const lineAmount = item.total_price ?? item.pricing?.final ?? 0;
          const fabricYards = (item.fabric_selections?.[0] as any)?.yardage;
          return this.buildManifestItem({
            name,
            kind: product?.kind,
            unitAmount: lineAmount,
            quantity: 1,
            fabricYards,
            baseWeightKg: product ? estimateProductWeightKg(product) : 0.5,
          });
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

    // Create shipment label.
    // If Shipbubble fails (e.g. insufficient account balance, invalid address
    // code), release the atomic claim so the shipment doesn't get stuck in
    // 'ready_to_ship'. Reverting to 'pending' lets the vendor retry once the
    // underlying issue is fixed. The original error is re-thrown so the vendor
    // still sees the real Shipbubble message.
    let shipmentResult;
    try {
      shipmentResult = await this.logisticService.createShipmentFromToken({
        request_token: requestToken,
        courier_id: courierId,
        service_code: serviceCode,
      });
    } catch (err: any) {
      await this.orderModel.updateOne(
        {
          reference: orderReference,
          shipments: {
            $elemMatch: {
              business: businessId,
              status: ShipmentStatus.READY_TO_SHIP,
            },
          },
        },
        { $set: { 'shipments.$.status': ShipmentStatus.PENDING } },
      );
      this.logger.error(
        `[Fulfill] Label creation failed for order ${orderReference} (business ${businessId}); ` +
        `reverted shipment ready_to_ship → pending. Reason: ${err?.response?.data?.message || err?.message}`,
      );
      throw err;
    }

    // Update shipment data. Shipbubble's create-label response identifies the
    // shipment by `order_id` (e.g. "SB-244512FE8276") and carries the courier
    // tracking code under `courier.tracking_code` — the same identifiers its
    // tracking webhook sends back. Capture both (with the older field names as
    // fallbacks) so the webhook can reliably match this shipment later.
    const sb: any = shipmentResult;
    order.shipments[shipmentIndex].shipment_id =
      sb.shipment_id ?? sb.order_id ?? null;
    order.shipments[shipmentIndex].tracking_number =
      sb.tracking_number ?? sb.courier?.tracking_code ?? sb.tracking_code ?? null;
    order.shipments[shipmentIndex].label_url =
      sb.label_url ?? sb.waybill_document ?? null;
    if (!order.shipments[shipmentIndex].courier_name) {
      order.shipments[shipmentIndex].courier_name =
        typeof sb.courier === 'string' ? sb.courier : sb.courier?.name;
    }
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
      // Once every vendor has shipped, the order is on its way — reflect that
      // to the customer immediately instead of leaving it at "processing" until
      // the courier's webhook fires (which can be delayed or missed in tests).
      order.status = OrderStatus.IN_TRANSIT;
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

    const capitalize = (s: string) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

    const genderColor = (raw: string | null): string => {
      const g = (raw || '').toLowerCase();
      if (g === 'male') return '#3d2817';
      if (g === 'female') return '#d4c5b9';
      return '#a0a0a0';
    };

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
              label: d._id ? capitalize(d._id) : 'Not set',
              value: d.count,
              color: genderColor(d._id),
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

  // "Sales by audience": which gender segment the vendor's SOLD items target,
  // taken from each product's taxonomy.audience (men/women/unisex). This is
  // reliably populated and meaningful — unlike the customer's profile gender,
  // which is almost always unset and doesn't say who the garment is for.
  async getBusinessOrdersByGenderChart(businessId: string): Promise<any> {
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
      { $unwind: { path: '$product_info', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          // Coalesce audience across the kind-specific taxonomies.
          _id: {
            $toLower: {
              $trim: {
                input: {
                  $ifNull: [
                    '$product_info.clothing.taxonomy.audience',
                    {
                      $ifNull: [
                        '$product_info.accessory.taxonomy.audience',
                        {
                          $ifNull: [
                            '$product_info.fabric.taxonomy.audience',
                            '',
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Normalise every audience value to Men / Women / Unisex.
    const bucketFor = (raw: string): 'Men' | 'Women' | 'Unisex' => {
      const g = (raw || '').toLowerCase();
      if (['men', 'male', 'man', 'boys'].includes(g)) return 'Men';
      if (['women', 'female', 'woman', 'girls'].includes(g)) return 'Women';
      return 'Unisex'; // unisex, blank, or anything unrecognised
    };
    const buckets = new Map<string, number>();
    for (const d of data) {
      const b = bucketFor(d._id as string);
      buckets.set(b, (buckets.get(b) ?? 0) + d.count);
    }

    const COLORS: Record<string, string> = {
      Men: '#3d2817',
      Women: '#d4c5b9',
      Unisex: '#9C8578',
    };
    const seriesData = ['Men', 'Women', 'Unisex']
      .filter((b) => (buckets.get(b) ?? 0) > 0)
      .map((b) => ({ label: b, value: buckets.get(b)!, color: COLORS[b] }));

    return {
      data: {
        chartType: 'pie',
        title: 'Sales by Audience',
        series: [
          {
            key: 'audience',
            name: 'Audience',
            data: seriesData,
          },
        ],
      },
    };
  }

  async getBusinessOrdersByLocationChart(businessId: string): Promise<any> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.business': new Types.ObjectId(businessId) } },
      // Collapse an order's multiple vendor items back to one row so we count
      // ORDERS, not line items. Location = the ORDER's shipping state (reliable),
      // not the customer's profile address (usually unset).
      {
        $group: {
          _id: '$_id',
          state: { $first: '$address.state' },
        },
      },
      {
        $group: {
          // Normalise: trim, and treat null/missing/blank state as 'Unknown'
          // (so a blank state doesn't render as an empty, unlabelled bar).
          _id: {
            $let: {
              vars: { s: { $trim: { input: { $ifNull: ['$state', ''] } } } },
              in: { $cond: [{ $eq: ['$$s', ''] }, 'Unknown', '$$s'] },
            },
          },
          count: { $sum: 1 },
        },
      },
      // Top states by order count for a clean chart.
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Orders by Location',
        series: [
          {
            key: 'orders',
            name: 'Orders',
            color: '#3d2817',
            data: data.map((d) => ({
              label: (d._id as string) || 'Unknown',
              value: d.count,
            })),
          },
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

    // Route to each business's OWNER (created_by.id), not users whose active
    // `business` field equals the id — a multi-business owner viewing a
    // different business would otherwise miss their new-order notification.
    const businesses = await this.businessModel
      .find({ _id: { $in: businessIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id created_by')
      .lean();

    const notifications: CreateNotificationDto[] = businesses
      .filter((biz: any) => biz.created_by?.id)
      .map((biz: any) => ({
        recipient: biz.created_by.id.toString(),
        recipient_business: biz._id?.toString(),
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

      const fabricYards = shipment.fabric_yards || 0;
      const fabricName = 'fabric'; // We could look up the product but keeping it simple

      // Route to each business's OWNER (created_by.id), NOT users whose active
      // User.business happens to equal the id. A multi-business owner viewing a
      // different business would otherwise never receive their notice (or the
      // wrong one) — the reported "fabric-transfer notifications on the wrong
      // vendor" symptom.
      const fabricOwnerId = (fabricBiz as any).created_by?.id?.toString();
      const tailorOwnerId = (tailorBiz as any).created_by?.id?.toString();

      // Notify fabric vendor: "Ship your fabric to the tailor"
      if (fabricOwnerId) {
        notifications.push({
          recipient: fabricOwnerId,
          recipient_business: fabricBizId,
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
      if (tailorOwnerId) {
        notifications.push({
          recipient: tailorOwnerId,
          recipient_business: tailorBizId,
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
  /**
   * Customer confirms satisfaction with a delivered order.
   * Sets release_date = now on all unreleased earnings so the next cron
   * run releases funds to the vendor(s) immediately.
   */
  async confirmCustomerSatisfaction(reference: string, customerId: string) {
    const order = await this.orderModel.findOne({
      reference,
      customer: customerId,
    });
    if (!order) throw new BadRequestException('Order not found');

    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException(
        'You can only confirm satisfaction for delivered orders',
      );
    }

    // Check if already confirmed
    if ((order as any).customer_satisfied) {
      return { message: 'You have already confirmed satisfaction for this order' };
    }

    // Set release_date to now on all unreleased earnings
    const result = await this.businessEarningsModel.updateMany(
      { order: order._id, released: false },
      { $set: { release_date: new Date() } },
    );

    // Mark on the order
    (order as any).customer_satisfied = true;
    (order as any).customer_satisfied_at = new Date();
    await order.save();

    this.logger.log(
      `[Satisfaction] Customer ${customerId} confirmed satisfaction for order ${reference}. ${result.modifiedCount} earning(s) set for immediate release.`,
    );

    // Notify each vendor
    const vendorBusinessIds = [...new Set(order.items.map(i => i.business?.toString()).filter(Boolean))];
    for (const businessId of vendorBusinessIds) {
      const business = await this.businessModel.findById(businessId);
      if (business?.created_by?.id) {
        this.notificationsService.create({
          recipient: business.created_by.id.toString(),
          category: NotificationCategory.ORDER,
          type: NotificationType.ORDER_CONFIRMED,
          title: 'Customer Confirmed Satisfaction! 🎉',
          body: `The customer has confirmed they're happy with order #${reference}. Your earnings will be released shortly.`,
          metadata: {
            order_id: order._id,
            order_reference: reference,
          },
          action_url: `/orders`,
        }).catch((err) =>
          this.logger.error(`Failed to notify vendor ${businessId}: ${err.message}`),
        );
      }
    }

    return {
      message: 'Thank you! Vendor earnings will be released shortly.',
      data: { earnings_released: result.modifiedCount },
    };
  }

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
