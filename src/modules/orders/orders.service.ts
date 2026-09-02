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
import { User, UserType } from '../ums/schemas';
import { LogisticsService } from '../logistics/logistics.service';
import { PaymentService } from '../payment/payment.service';
import { BusinessService } from '../business/business.service';
import { ProductService } from '../products/products.service';
import { computeAvailability } from '../products/product-availability';
import {
  Business,
  BusinessDocument,
  BusinessStatus,
} from '../business/schemas/business.schema';
import { BusinessEarningDocument } from '../business/schemas/business-earnings.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { ProviderRouter } from '../payment-providers/provider-router.service';
import { CurrencyService } from '../currency/currency.service';
import { buildPurchaseEvents } from '../recommendations/events/purchase-events.util';
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
import { percentageChange } from '../../common/utils/percentageChange';
import type {
  AdminDashboardChartsDto,
  ChartDto,
  ExpectedEarningsChartDto,
} from '../platform/dto/admin-dashboard-charts.dto';
import type {
  CustomerAnalyticsDto,
  CustomerAnalyticsSummaryDto,
} from '../platform/dto/customer-analytics.dto';
import type { EventDocument } from '../recommendations/events/schemas/event.schema';
import type { AdminProfileOverviewDto } from '../platform/dto/admin-profile.dto';
import { Ticket, TicketStatus } from '../ticket/schema/ticket.schema';

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
    @InjectModel('Event') private eventModel: Model<EventDocument>,
    // Read-only: tickets are the work the platform assigns to an admin,
    // so they back the profile drawer's task list and counters.
    @InjectModel(Ticket.name) private ticketModel: Model<Ticket>,
    @Inject(forwardRef(() => WalletsService))
    private readonly walletsService: WalletsService,
    private readonly notificationsService: NotificationsService,
    private readonly businessService: BusinessService,
    private readonly productService: ProductService,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
    // Multi-currency (plan Phase 3): routes non-NGN charges to Stripe and
    // locks the checkout FX rate.
    private readonly providerRouter: ProviderRouter,
    private readonly currencyService: CurrencyService,
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
      // Per-item measurement snapshots: one order can carry custom garments
      // for DIFFERENT bodies (asoebi/family orders), so each item freezes the
      // set named on its cart line; item name > order-level name > active set.
      const rawItems: any[] = (orderData.items as any[]) || [];
      const resolveBodyProfile = (setName?: string | null) => {
        const sets: any[] = (fullCustomer as any)?.measurementSets || [];
        if (!sets.length) return null;
        const chosen =
          (setName && sets.find((s) => s.name === setName)) ||
          sets.find((s) => s.active);
        if (!chosen) return null;
        return {
          body_type:
            (fullCustomer as any)?.body_type_classification?.bodyType ?? null,
          confidence:
            (fullCustomer as any)?.body_type_classification?.confidence ??
            null,
          measurements: chosen.measurements || {},
          unit: chosen.unit || 'cm',
          fit_preferences: (fullCustomer as any)?.body_fit || [],
          set_name: chosen.name || null,
        };
      };
      const itemSetName = (idx: number, productId: any): string | undefined => {
        // Prefer positional match (raw and processed items are same-order);
        // fall back to product id if the pipeline ever reshapes the list.
        const byIndex =
          rawItems.length === processedItems.length ? rawItems[idx] : undefined;
        if (byIndex?.measurement_set_name) return byIndex.measurement_set_name;
        return rawItems.find(
          (ri) =>
            String(ri.product_id) === String(productId) &&
            ri.measurement_set_name,
        )?.measurement_set_name;
      };

      const normalizedItems = processedItems.map((item, itemIdx) => {
        const selections = item.selections || {};

        return {
          body_profile:
            item.clothing_type === ClothingType.CUSTOMIZE
              ? resolveBodyProfile(
                  itemSetName(itemIdx, item.product_id) ??
                    orderData.measurement_set_name,
                )
              : null,
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
              // Snapshot the colour name + hex so order/item views can show the
              // colour without re-resolving it from the (mutable) product.
              color: cv.color,
              hex: cv.hex,
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
        set_name?: string | null;
      } | undefined = undefined;
      if (isBespoke && fullCustomer?.body_type_classification && fullCustomer?.measurementSets?.length) {
        // The customer can order for someone else ("For Tolu") by naming one
        // of their saved measurement sets; otherwise the active set is used.
        const chosenSet =
          (orderData.measurement_set_name &&
            fullCustomer.measurementSets.find(
              (s) => s.name === orderData.measurement_set_name,
            )) ||
          fullCustomer.measurementSets.find((s) => s.active);
        if (chosenSet) {
          customer_body_profile = {
            body_type: fullCustomer.body_type_classification.bodyType,
            confidence: fullCustomer.body_type_classification.confidence,
            measurements: chosenSet.measurements,
            unit: chosenSet.unit,
            fit_preferences: fullCustomer.body_fit || [],
            set_name: chosenSet.name || null,
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

          // Recommender purchase signal (wallet orders never reach the webhook
          // finalisation path, so emit here). Fire-and-forget.
          {
            const purchaseEvents = buildPurchaseEvents(savedOrder);
            if (purchaseEvents.length) {
              this.eventModel
                .insertMany(purchaseEvents, { ordered: false })
                .catch((e: any) =>
                  this.logger.warn(
                    `Failed to record purchase events: ${e?.message}`,
                  ),
                );
            }
          }
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
        // --- INTERNATIONAL CARD PAYMENT (multi-currency plan Phase 3) ---
        // Non-NGN charge: lock the FX rate (fail-closed quote + markup), stamp
        // the order's money legs, and charge via the routed provider (Stripe).
        // The ledger transaction stays ₦ (the settlement/base amount); the
        // charge currency + minor-unit amount ride in its metadata.
        const chargeCurrency = (orderData.currency ?? 'NGN').toUpperCase();
        if (chargeCurrency !== 'NGN') {
          const provider =
            await this.providerRouter.paymentProviderFor(chargeCurrency);
          const fxSettings: any = await this.platformSettingsModel
            .findOne()
            .lean();
          const quote = await this.currencyService.quote(
            'NGN',
            chargeCurrency,
            fxSettings?.fx_markup_percent ?? 2,
          );
          const amountMinor = Math.round(
            savedOrder.total * quote.effective_rate * 100,
          );
          if (amountMinor < 1) {
            throw new BadRequestException('Charge amount too small.');
          }

          savedOrder.presentment_currency = chargeCurrency;
          savedOrder.settlement_currency = 'NGN';
          savedOrder.fx_rate = quote.effective_rate;
          savedOrder.fx_markup_percent = quote.markup_percent;
          savedOrder.processor = 'stripe';
          savedOrder.entity = 'us';
          savedOrder.group_amount_usd =
            chargeCurrency === 'USD' ? amountMinor : null;
          await savedOrder.save();

          const intlTransaction = await this.transactionService.create({
            initiator: new Types.ObjectId(customer.id),
            order: savedOrder.id,
            type: TransactionType.DEBIT,
            amount: savedOrder.total, // ₦ settlement amount (ledger base)
            description: `Order payment for order ${savedOrder.reference}`,
            channel: 'checkout',
            metadata: {
              order_reference: savedOrder.reference,
              items_count: savedOrder.items.length,
              payment_method: 'stripe',
              charge_currency: chargeCurrency,
              charge_amount_minor: amountMinor,
              fx_rate: quote.effective_rate,
              fx_markup_percent: quote.markup_percent,
              fx_quoted_at: quote.quoted_at,
            },
          });

          const init = await provider.initCharge({
            reference: intlTransaction.reference,
            email: customer.email,
            currency: chargeCurrency,
            amount_minor: amountMinor,
          });

          this.notifyVendorsNewOrder(savedOrder, customer).catch((err) =>
            this.logger.error('Failed to send new order notifications', err),
          );
          this.notifyFabricTransfers(savedOrder).catch((err) =>
            this.logger.error(
              'Failed to send fabric transfer notifications',
              err,
            ),
          );

          return {
            message: 'Order created successfully. Redirect to payment.',
            data: {
              order: savedOrder,
              transaction: {
                reference: intlTransaction.reference,
                amount: intlTransaction.amount,
                status: intlTransaction.status,
                metadata: intlTransaction.metadata,
              },
              payment: {
                authorization_url: init.authorization_url,
                reference: intlTransaction.reference,
                processor: 'stripe',
                charge_currency: chargeCurrency,
                charge_amount_minor: amountMinor,
              },
            },
          };
        }

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

      // TEMP(diagnostic): surface the real cause in the response so we can see
      // what's actually failing (revert to the generic message once fixed).
      throw new InternalServerErrorException(
        `Unable to create order [${error?.name || 'Error'}]: ${error?.message || 'unknown error'}`,
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
    // `color_variant_id` is expected to be the INNER size-variant _id (a specific
    // size within a colour) — that is what inventory deduction matches on. Some
    // clients instead send the OUTER colour-variant _id, so fall back to
    // resolving the size within that colour via the `size` field (or the sole
    // variant). Either way we normalise to the inner size-variant id; without
    // this the selection stored empty and stock never changed.
    const normalizedColorVariants: VariantSelectionDto[] = [];
    for (const cvs of selections.color_variant_selections || []) {
      let colorVariant = clothing?.color_variants?.find((cv) =>
        cv.variants.some((v) => v._id?.equals(cvs.color_variant_id)),
      );
      let variant = colorVariant?.variants.find((v) =>
        v._id?.equals(cvs.color_variant_id),
      );

      // Fallback: the id was the OUTER colour variant → pick the size within it.
      if (!variant) {
        const outer = clothing?.color_variants?.find((cv) =>
          (cv as any)._id?.equals(cvs.color_variant_id),
        );
        if (outer) {
          colorVariant = outer;
          variant =
            (cvs.size
              ? outer.variants.find(
                  (v) =>
                    v.size?.toLowerCase() === String(cvs.size).toLowerCase(),
                )
              : undefined) ??
            (outer.variants.length === 1 ? outer.variants[0] : undefined);
        }
      }
      if (!colorVariant || !variant) continue;

      const quantity = cvs.quantity ?? 1;
      // `variant.price` is an "extra cost" SURCHARGE added on top of the
      // product's selling price (discounted → base), not a replacement. 0/unset
      // → just the base price.
      const base =
        product.discounted_price && product.discounted_price > 0
          ? product.discounted_price
          : (product.base_price ?? 0);
      const unitPrice = base + (variant.price || 0);
      normalizedColorVariants.push({
        color_variant_id: new Types.ObjectId(variant._id),
        size: variant.size,
        // Colour name + hex from the parent colour variant, snapshotted so the
        // order/item views can show the colour directly.
        color: colorVariant.name,
        hex: colorVariant.hex,
        price: unitPrice,
        quantity,
        total_amount: unitPrice * quantity,
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
        // Snapshot the accessory name + chosen variant colour so order/item
        // views can show them without re-resolving the product.
        name: isAccessoryExist.name,
        color: (accessoryVariant as any)?.color?.name,
        hex: (accessoryVariant as any)?.color?.hex,
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
    customer?: Types.ObjectId,
    reference?: string,
  ) {
    try {
      const { skip, take } = await Utils.getPagination(page, size);
      const filter: any = {};
      // Single-order lookup (vendor drawer opened from outside the orders
      // list, e.g. a customer's order history) — same populates + scoping.
      if (reference) {
        filter.reference = reference;
      }
      // Admin customer detail page: the same list, narrowed to one buyer.
      if (customer) {
        filter.customer = customer;
      }
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
        // Reservation FEE orders reference the fabric vendor on their item but
        // are platform revenue with nothing to fulfil — showing them to the
        // vendor reads as an unpaid order they can never action. Claims
        // (type 'reservation_claim') DO show: the vendor hands over those yards.
        filter.type = { $ne: 'reservation' };
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
    // Exclude items the vendor rejected — they've been refunded, so they no
    // longer count toward this vendor's subtotal / commission / net earnings.
    const myItems = (order?.items || []).filter(
      (i: any) => String(i?.business) === bid && !i?.rejected,
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
      .select('customer items shipments customer_body_profile')
      .populate('items.product', 'name')
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

    // Per-item snapshots first: one order can carry garments for DIFFERENT
    // bodies. Vendors see only their own items' profiles; admin sees all.
    const hasMeasurements = (p: any) =>
      p?.measurements && Object.keys(p.measurements).length > 0;
    const itemProfiles = (((order as any).items || []) as any[])
      .filter(
        (i) =>
          hasMeasurements(i.body_profile) &&
          !i.rejected &&
          (!scopeBusinessId ||
            String(i.business) === String(scopeBusinessId)),
      )
      .map((i) => ({
        product_name: (i.product as any)?.name ?? null,
        set_name: i.body_profile.set_name ?? null,
        unit: i.body_profile.unit || 'cm',
        snapshot: true,
        measurements: i.body_profile.measurements,
      }));

    // Prefer the ORDER-TIME snapshot: the customer may have ordered with a
    // different set (e.g. a friend's), or edited/switched sets since. Reading
    // the live profile here risks sewing the garment to the wrong body.
    const snapshot = (order as any).customer_body_profile;
    if (hasMeasurements(snapshot)) {
      return {
        data: {
          full_name: (user as any).full_name,
          name: snapshot.set_name || 'At time of order',
          unit: snapshot.unit || 'cm',
          active: false,
          snapshot: true,
          updatedAt: null,
          measurements: snapshot.measurements,
          items: itemProfiles,
        },
      };
    }

    // No order-level snapshot but per-item ones exist (future-proofing).
    if (itemProfiles.length > 0) {
      const first = itemProfiles[0];
      return {
        data: {
          full_name: (user as any).full_name,
          name: first.set_name || 'At time of order',
          unit: first.unit,
          active: false,
          snapshot: true,
          updatedAt: null,
          measurements: first.measurements,
          items: itemProfiles,
        },
      };
    }

    // Legacy orders (no snapshot): fall back to the live active set.
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
    const [
      totalOrders,
      ordersDelivered,
      ordersInTransit,
      topProducts,
      totalVendors,
      verifiedVendors,
      totalCustomers,
      grossSales,
      trend,
    ] = await Promise.all([
      this.orderModel.countDocuments(), // total orders
      this.orderModel.countDocuments({ status: OrderStatus.COMPLETED }), // delivered
      this.orderModel.countDocuments({ status: OrderStatus.PROCESSING }), // in transit
      this.orderModel.aggregate([
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            totalOrdered: {
              // Units per item live inside the selection arrays, so each one is
              // summed on its own first — `$sum` over a list of array-valued
              // expressions skips them as non-numeric and yields 0. Styles and
              // addons are options ON a unit, not units, so they are excluded.
              $sum: {
                $add: [
                  { $sum: '$items.color_variant_selections.quantity' },
                  { $sum: '$items.fabric_selections.quantity' },
                  { $sum: '$items.accessory_selections.quantity' },
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
            // Products are polymorphic on `kind`: the name lives under the
            // kind-specific subdocument, never at the top level.
            name: {
              $ifNull: [
                '$product.clothing.name',
                {
                  $ifNull: [
                    '$product.accessory.name',
                    { $ifNull: ['$product.fabric.name', null] },
                  ],
                },
              ],
            },
            totalOrdered: 1,
          },
        },
      ]),
      this.businessModel.countDocuments(), // total vendors
      this.businessModel.countDocuments({ status: BusinessStatus.VERIFIED }), // verified vendors
      // Same definition of "customer" the admin customers list uses, so the
      // card and the table can never disagree.
      this.userModel.countDocuments({ type: UserType.CUSTOMER }),
      // Gross, not net: every order the customer actually paid for, before
      // refunds, commission or payouts are taken out.
      this.orderModel.aggregate<{ _id: null; total: number }>([
        { $match: { payment_status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      this.getRecentTrend(),
    ]);



    return {
      total_orders: totalOrders,
      orders_delivered: ordersDelivered,
      orders_in_transit: ordersInTransit,
      total_vendors: totalVendors,
      verified_vendors: verifiedVendors,
      total_customers: totalCustomers,
      gross_sales: grossSales[0]?.total ?? 0,
      must_purchase_products: topProducts,
      changes: {
        period_days: OrderService.TREND_WINDOW_DAYS,
        total_orders: percentageChange(...trend.orders),
        orders_delivered: percentageChange(...trend.delivered),
        orders_in_transit: percentageChange(...trend.inTransit),
        total_vendors: percentageChange(...trend.vendors),
        verified_vendors: percentageChange(...trend.verifiedVendors),
        total_customers: percentageChange(...trend.customers),
        gross_sales: percentageChange(...trend.grossSales),
      },
    };
  }

  /** How far back the stat cards' percentage badges compare. */
  private static readonly TREND_WINDOW_DAYS = 30;

  /** `[current, previous]` counts for one metric over the trend window. */
  private static pair(
    rows: Record<string, { n: number }[]> | undefined,
    key: string,
  ): [number, number] {
    return [rows?.[`${key}Current`]?.[0]?.n ?? 0, rows?.[`${key}Previous`]?.[0]?.n ?? 0];
  }

  /**
   * Movement over the trend window versus the window before it, for every stat
   * card that has a countable history.
   *
   * CAVEAT on the delivered / in-transit / verified figures: neither an Order
   * nor a Business carries a per-status timestamp — `delivered_at` lives on
   * VendorShipment, not the order — so there is no record of *when* something
   * reached a status. Those three count documents currently in that status
   * whose `updatedAt` falls in the window. It is a good proxy (a completed
   * order is rarely written to again) but it is not throughput. The
   * creation-based figures — total orders, vendors, customers, gross sales —
   * carry no such caveat.
   */
  private async getRecentTrend(): Promise<{
    orders: [number, number];
    delivered: [number, number];
    inTransit: [number, number];
    vendors: [number, number];
    verifiedVendors: [number, number];
    customers: [number, number];
    grossSales: [number, number];
  }> {
    const days = OrderService.TREND_WINDOW_DAYS;
    const now = Date.now();
    const current = { $gte: new Date(now - days * 86_400_000) };
    const previous = {
      $gte: new Date(now - 2 * days * 86_400_000),
      $lt: new Date(now - days * 86_400_000),
    };

    const count = (match: Record<string, unknown>) => [
      { $match: match },
      { $count: 'n' },
    ];
    // Gross sales is money, not a count, so it sums into the same `n` shape the
    // others produce — keeping one reader for the whole facet.
    const sum = (match: Record<string, unknown>) => [
      { $match: match },
      { $group: { _id: null, n: { $sum: '$total' } } },
    ];

    const [orderRows, businessRows, customerRows] = await Promise.all([
      this.orderModel.aggregate<Record<string, { n: number }[]>>([
        {
          $facet: {
            ordersCurrent: count({ createdAt: current }),
            ordersPrevious: count({ createdAt: previous }),
            deliveredCurrent: count({
              status: OrderStatus.COMPLETED,
              updatedAt: current,
            }),
            deliveredPrevious: count({
              status: OrderStatus.COMPLETED,
              updatedAt: previous,
            }),
            inTransitCurrent: count({
              status: OrderStatus.PROCESSING,
              updatedAt: current,
            }),
            inTransitPrevious: count({
              status: OrderStatus.PROCESSING,
              updatedAt: previous,
            }),
            grossSalesCurrent: sum({
              payment_status: 'paid',
              createdAt: current,
            }),
            grossSalesPrevious: sum({
              payment_status: 'paid',
              createdAt: previous,
            }),
          },
        },
      ]),
      this.businessModel.aggregate<Record<string, { n: number }[]>>([
        {
          $facet: {
            vendorsCurrent: count({ createdAt: current }),
            vendorsPrevious: count({ createdAt: previous }),
            verifiedVendorsCurrent: count({
              status: BusinessStatus.VERIFIED,
              updatedAt: current,
            }),
            verifiedVendorsPrevious: count({
              status: BusinessStatus.VERIFIED,
              updatedAt: previous,
            }),
          },
        },
      ]),
      this.userModel.aggregate<Record<string, { n: number }[]>>([
        {
          $facet: {
            customersCurrent: count({
              type: UserType.CUSTOMER,
              createdAt: current,
            }),
            customersPrevious: count({
              type: UserType.CUSTOMER,
              createdAt: previous,
            }),
          },
        },
      ]),
    ]);

    const orders = orderRows[0];
    const businesses = businessRows[0];
    const customers = customerRows[0];

    return {
      orders: OrderService.pair(orders, 'orders'),
      delivered: OrderService.pair(orders, 'delivered'),
      inTransit: OrderService.pair(orders, 'inTransit'),
      grossSales: OrderService.pair(orders, 'grossSales'),
      vendors: OrderService.pair(businesses, 'vendors'),
      verifiedVendors: OrderService.pair(businesses, 'verifiedVendors'),
      customers: OrderService.pair(customers, 'customers'),
    };
  }

  async getVendorDashboardMetrics(businessId: Types.ObjectId) {
    const [
      totalOrders,
      ordersDelivered,
      ordersInTransit,
      topProducts,
      grossSales,
      totalProducts,
      totalCustomers,
    ] = await Promise.all([
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
              // Products are polymorphic on `kind`: the name lives under the
              // kind-specific subdocument, never at the top level. Reading
              // `$product.name` sent null for every row, which is why the
              // vendor dashboard's "Most purchased" card had nothing to show.
              name: {
                $ifNull: [
                  '$product.clothing.name',
                  {
                    $ifNull: [
                      '$product.accessory.name',
                      { $ifNull: ['$product.fabric.name', null] },
                    ],
                  },
                ],
              },
              totalOrdered: 1,
            },
          },
        ]),
        // Gross: what customers paid on this vendor's orders, before refunds,
        // commission and payouts — the same definition the platform-wide
        // gross_sales uses.
        this.orderModel.aggregate<{ _id: null; total: number }>([
          { $match: { 'items.business': businessId, payment_status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        this.productModel.countDocuments({ business: businessId }),
        // Distinct buyers, not orders: a customer who ordered five times is one
        // customer.
        this.orderModel.distinct('customer', {
          'items.business': businessId,
        }),
      ]);

    return {
      total_orders: totalOrders,
      orders_delivered: ordersDelivered,
      orders_in_transit: ordersInTransit,
      must_purchase_products: topProducts,
      // Added for the admin console's per-vendor Analytics cards, which had
      // nothing to read and showed a dash for every figure.
      gross_sales: grossSales[0]?.total ?? 0,
      total_products: totalProducts,
      total_customers: totalCustomers.length,
    };
  }

  async cancelOrder(reference: string, opts?: { customerId?: string }) {
    const order = await this.orderModel.findOne({ reference });
    if (!order) throw new BadRequestException('Order not found');

    // When a customer initiates the cancel, it must be their own order.
    if (
      opts?.customerId &&
      order.customer?.toString() !== String(opts.customerId)
    ) {
      throw new ForbiddenException('You can only cancel your own orders');
    }

    // Prevent cancelling already cancelled orders.
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    // Cancellation is only valid before the order ships. Once it's in transit,
    // completed or returned, the customer must go through returns/disputes.
    const NON_CANCELLABLE: OrderStatus[] = [
      OrderStatus.IN_TRANSIT,
      OrderStatus.COMPLETED,
      OrderStatus.RETURNED,
    ];
    if (NON_CANCELLABLE.includes(order.status)) {
      throw new BadRequestException(
        'This order can no longer be cancelled because it has shipped. Please request a return instead.',
      );
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
    itemId?: string,
  ) {
    const filter: any = { order: order._id };
    if (businessId) filter.business = new Types.ObjectId(businessId);
    // Per-item reversal: only this item's earning (both the vendor's own and,
    // for an applied-fabric item, the fabric vendor's linked earning).
    if (itemId) filter.item = new Types.ObjectId(itemId);

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

    // Reset order-level earnings fields only on a FULL reversal (no per-vendor,
    // no per-item scoping) — a partial reversal must leave them intact.
    if (!businessId && !itemId) {
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
  /**
   * Complete a reservation-claim order by handover. Claim orders (guests
   * buying yards from an event fabric reservation) carry no shipment — no
   * address is collected and the guest collects their cut — so the normal
   * confirm → fulfill → courier-delivery pipeline never applies to them.
   * This is their entire fulfilment: mark the order completed and schedule
   * the vendor's earnings release with the standard payout delay (the step
   * courier delivery would otherwise have triggered).
   */
  async completeClaimHandover(
    orderReference: string,
    business: Business | BusinessDocument,
  ) {
    const businessId = (business._id || (business as any).id).toString();

    const order = await this.orderModel.findOne({ reference: orderReference });
    if (!order) throw new BadRequestException('Order not found');

    if ((order as any).type !== 'reservation_claim') {
      throw new BadRequestException(
        'Only reservation fabric claims can be completed by handover',
      );
    }
    const ownsItem = order.items.some(
      (i) => i.business?.toString() === businessId,
    );
    if (!ownsItem) {
      throw new BadRequestException('This claim does not belong to your store');
    }
    if ((order as any).payment_status !== 'paid') {
      throw new BadRequestException(
        'This claim has not been paid for yet — it cannot be handed over',
      );
    }
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('This claim is already handed over');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('This claim was cancelled');
    }

    order.status = OrderStatus.COMPLETED;
    await order.save();

    // Schedule the earnings release that courier delivery would normally
    // trigger — same payout-delay window as delivered shipments.
    const settings = await this.platformSettingsModel.findOne().lean();
    const payoutDelayDays = (settings as any)?.payout_delay_days ?? 3;
    const releaseDate = new Date(
      Date.now() + payoutDelayDays * 24 * 60 * 60 * 1000,
    );
    const res = await this.businessEarningsModel.updateMany(
      {
        order: order._id,
        business: new Types.ObjectId(businessId),
        released: false,
        release_date: null,
      },
      { $set: { release_date: releaseDate } },
    );
    this.logger.log(
      `[Handover] Claim ${orderReference} handed over by vendor ${businessId} — scheduled ${res.modifiedCount} earning(s) for ${releaseDate.toISOString()}`,
    );

    return {
      message:
        'Claim marked as handed over. Your earnings are scheduled for release.',
      data: order,
    };
  }

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

    // A declined FABRIC TRANSFER can't be unwound as one vendor's slice: the
    // fabric vendor has no order items (the fabric is billed as external_fabric
    // on the tailor's item and deducted from the fabric vendor's product), and
    // without the customer's chosen fabric the bespoke garment can't be made.
    // So cancel the WHOLE order — full refund, restore all stock (incl. the
    // applied fabric), reverse all earnings.
    if (shipment.shipment_type === ShipmentType.FABRIC_TRANSFER) {
      const { refundAmount, orderCancelled } =
        await this.unwindRejectedFabricTransfer(
          order,
          shipment,
          reason || 'Fabric vendor declined the order',
        );
      this.notifyCustomerVendorRejected(order, business, reason).catch((err) =>
        this.logger.error('Failed to send fabric rejection notification', err),
      );
      if (orderCancelled) {
        this.notifyVendorsOrderCancelled(order).catch(() => undefined);
      }
      return {
        message: orderCancelled
          ? `Fabric transfer declined — the order was cancelled and ₦${refundAmount.toLocaleString()} refunded to the customer.`
          : `Fabric transfer declined — the affected garment was cancelled and ₦${refundAmount.toLocaleString()} refunded. Other vendors' items are unaffected.`,
        data: {
          rejected: true,
          order_cancelled: orderCancelled,
          refund_amount: refundAmount,
          order_status: order.status,
        },
      };
    }

    // Reject every one of the vendor's still-active items (skipping any already
    // rejected individually, to avoid double refund/restock). This also fails
    // their shipment + refunds its shipping since no active items remain.
    const activeItems = order.items.filter(
      (i) => i.business?.toString() === businessId && !(i as any).rejected,
    );
    const { refundAmount, orderCancelled } = await this._rejectItems(
      order,
      businessId,
      activeItems,
      reason || 'Vendor declined the order',
    );

    // Defensive: if the vendor had no catalog items, still fail the shipment.
    if (!shipment.rejected) {
      shipment.rejected = true;
      shipment.rejected_at = new Date();
      shipment.rejection_reason = reason || 'Vendor declined the order';
      shipment.status = ShipmentStatus.FAILED;
      order.markModified('shipments');
      await order.save();
    }

    // Notify customer about rejection
    this.notifyCustomerVendorRejected(order, business, reason).catch((err) =>
      this.logger.error('Failed to send vendor rejection notification', err),
    );
    if (orderCancelled) {
      this.notifyVendorsOrderCancelled(order).catch(() => undefined);
    }

    return {
      message: `Shipment rejected. ₦${refundAmount.toLocaleString()} will be refunded to the customer.`,
      data: {
        rejected: true,
        refund_amount: refundAmount,
        order_cancelled: orderCancelled,
        order_status: order.status,
      },
    };
  }

  /**
   * Vendor rejects (declines) a SINGLE item in an order — e.g. out of stock on
   * one line while fulfilling the rest. Refunds + restocks only that item; the
   * rest of the order proceeds. If it was the vendor's last active item, their
   * shipment is failed and its shipping refunded; if it was the order's last
   * active item, the order is cancelled.
   */
  async rejectOrderItem(
    orderReference: string,
    business: Business | BusinessDocument,
    itemId: string,
    reason?: string,
  ) {
    const businessId = (business._id || (business as any).id).toString();
    const order = await this.orderModel.findOne({ reference: orderReference });
    if (!order) throw new BadRequestException('Order not found');

    const item = order.items.find(
      (i) =>
        String((i as any)._id) === String(itemId) &&
        i.business?.toString() === businessId,
    );
    if (!item) {
      throw new BadRequestException(
        'No such item in this order for your business',
      );
    }
    if ((item as any).rejected) {
      throw new BadRequestException('This item has already been rejected');
    }

    // The vendor's garment shipment must not have been dispatched yet.
    const shipment = order.shipments.find(
      (s) =>
        s.shipment_type !== ShipmentType.FABRIC_TRANSFER &&
        s.business?.toString() === businessId,
    );
    if (
      shipment &&
      (shipment.rejected ||
        shipment.status === ShipmentStatus.SHIPPED ||
        shipment.status === ShipmentStatus.IN_TRANSIT ||
        shipment.status === ShipmentStatus.DELIVERED)
    ) {
      throw new BadRequestException(
        'Cannot reject an item once its shipment has been dispatched.',
      );
    }

    const { refundAmount, orderCancelled } = await this._rejectItems(
      order,
      businessId,
      [item],
      reason || 'Vendor declined this item',
    );

    this.notifyCustomerVendorRejected(order, business, reason).catch((err) =>
      this.logger.error('Failed to send item rejection notification', err),
    );
    if (orderCancelled) {
      this.notifyVendorsOrderCancelled(order).catch(() => undefined);
    }

    return {
      message: `Item rejected. ₦${refundAmount.toLocaleString()} refunded to the customer.`,
      data: {
        rejected: true,
        item_id: String(itemId),
        refund_amount: refundAmount,
        order_cancelled: orderCancelled,
        order_status: order.status,
      },
    };
  }

  /**
   * Shared core for rejecting a set of a vendor's items. Marks each item
   * rejected, fails any fabric-transfer leg that fed it, and (once the vendor
   * has no active items left) fails their garment shipment. Refunds each item's
   * total + its external-fabric value + the freed shipping legs, restores each
   * item's stock (+ applied fabric), and reverses each item's earnings — the
   * vendor's own AND the fabric vendor's linked one (a per-item earnings
   * reversal keyed on the item covers both). Cancels the order only if no active
   * shipment remains. NOT internally idempotent — callers ensure single run.
   */
  private async _rejectItems(
    order: OrderDocument,
    businessId: string,
    items: any[],
    reason: string,
  ): Promise<{ refundAmount: number; orderCancelled: boolean }> {
    let fabricLegShipping = 0;
    let itemsGoodsTotal = 0; // total_price only (for subtotal adjustment)
    let itemsRefund = 0; // total_price + external_fabric (for the refund)

    for (const item of items) {
      item.rejected = true;
      item.rejected_at = new Date();
      item.rejection_reason = reason;
      const goods = item.total_price || 0;
      const externalFabric = item.pricing?.external_fabric || 0;
      itemsGoodsTotal += goods;
      itemsRefund += goods + externalFabric;

      // Fail the fabric-transfer leg that fed this item (if any).
      const appliedFabricId = item.applied_fabric;
      if (appliedFabricId) {
        const leg = order.shipments.find(
          (s) =>
            s.shipment_type === ShipmentType.FABRIC_TRANSFER &&
            String(s.fabric_product) === String(appliedFabricId) &&
            s.destination_business?.toString() === businessId &&
            !s.rejected,
        );
        if (leg) {
          leg.rejected = true;
          leg.rejected_at = new Date();
          leg.rejection_reason = 'Dependent garment item cancelled';
          leg.status = ShipmentStatus.FAILED;
          fabricLegShipping += leg.shipping_fee || 0;
        }
      }
    }

    // If the vendor has no active items left, fail their garment shipment and
    // refund its shipping too.
    const vendorHasActiveItems = order.items.some(
      (i) => i.business?.toString() === businessId && !(i as any).rejected,
    );
    let vendorShipping = 0;
    if (!vendorHasActiveItems) {
      const vendorShipment = order.shipments.find(
        (s) =>
          s.shipment_type !== ShipmentType.FABRIC_TRANSFER &&
          s.business?.toString() === businessId &&
          !s.rejected,
      );
      if (vendorShipment) {
        vendorShipment.rejected = true;
        vendorShipment.rejected_at = new Date();
        vendorShipment.rejection_reason = 'All items rejected by vendor';
        vendorShipment.status = ShipmentStatus.FAILED;
        vendorShipping = vendorShipment.shipping_fee || 0;
      }
    }

    const refundAmount = itemsRefund + fabricLegShipping + vendorShipping;

    // Adjust order totals.
    order.subtotal = Math.max(0, (order.subtotal || 0) - itemsGoodsTotal);
    order.shipping_fee = Math.max(
      0,
      (order.shipping_fee || 0) - fabricLegShipping - vendorShipping,
    );
    order.total = Math.max(0, (order.total || 0) - refundAmount);

    // Cancel the order only if no active shipment remains.
    const orderCancelled =
      order.shipments.length > 0 && order.shipments.every((s) => s.rejected);
    if (orderCancelled) {
      order.status = OrderStatus.CANCELLED;
      (order as any).refund_status = 'refunded';
    } else {
      const active = order.shipments.filter((s) => !s.rejected);
      if (active.length && active.every((s) => s.confirmed)) {
        order.status = OrderStatus.PROCESSING;
      }
    }

    order.markModified('items');
    order.markModified('shipments');
    await order.save();

    // Refund the customer.
    await this.processPartialRefund(order, refundAmount, reason).catch((err) =>
      this.logger.error(
        `[ItemReject] Refund failed for ${order.reference}: ${err.message}`,
      ),
    );

    // Reverse earnings + restore stock per item. A per-item reversal keyed on
    // (order, item) reverses BOTH the vendor's earning and the fabric vendor's
    // linked one; restoreInventory(item) returns the item's stock + applied
    // fabric.
    for (const item of items) {
      const itemId = String(item._id);
      await this.reverseBusinessEarnings(order, undefined, itemId).catch((err) =>
        this.logger.error(
          `[ItemReject] Earnings reversal failed for item ${itemId} on ${order.reference}: ${err.message}`,
        ),
      );
      await this.productService
        .restoreInventory(order._id as Types.ObjectId, businessId, itemId)
        .catch((err) =>
          this.logger.error(
            `[ItemReject] Inventory restore failed for item ${itemId} on ${order.reference}: ${err.message}`,
          ),
        );
    }

    return { refundAmount, orderCancelled };
  }

  /**
   * Unwinds a declined fabric transfer WITHOUT touching unrelated vendors. The
   * fabric leg (fabric vendor → tailor) and the tailor's dependent garment
   * shipment are failed and refunded — garment item totals + the external-fabric
   * value the customer paid the fabric vendor + BOTH shipping legs — and the
   * tailor's item stock + the applied fabric are restored, with the fabric
   * vendor's and tailor's earnings reversed. Every OTHER vendor on the order is
   * left alone. The order is cancelled only if no active shipment remains.
   * Returns the amount refunded and whether the whole order cancelled.
   *
   * Scoped at the tailor-SHIPMENT granularity (order items have no id to target
   * yet), so a tailor who also had an unrelated item in the SAME order would see
   * that item cancelled too — acceptable until per-item rejection lands.
   *
   * NOTE: the refund is not internally idempotent — callers must ensure it runs
   * once per order (the manual path is a single user action; the auto-reject
   * cron claims the shipment's `refunded` flag before calling).
   */
  private async unwindRejectedFabricTransfer(
    order: OrderDocument,
    fabricShipment: any,
    reason: string,
  ): Promise<{ refundAmount: number; orderCancelled: boolean }> {
    const fabricVendorId = fabricShipment.business.toString();
    const tailorId = fabricShipment.destination_business?.toString();

    // 1) Fail the fabric leg.
    fabricShipment.rejected = true;
    fabricShipment.rejected_at = new Date();
    fabricShipment.rejection_reason = reason;
    fabricShipment.status = ShipmentStatus.FAILED;

    // 2) Fail the tailor's garment shipment — it can't proceed without the
    //    customer's fabric. Other vendors' shipments are untouched.
    const tailorShipment = order.shipments.find(
      (s) =>
        s.shipment_type !== ShipmentType.FABRIC_TRANSFER &&
        tailorId != null &&
        s.business?.toString() === tailorId &&
        !s.rejected,
    );
    if (tailorShipment) {
      tailorShipment.rejected = true;
      tailorShipment.rejected_at = new Date();
      tailorShipment.rejection_reason =
        'Cancelled: required fabric transfer was declined';
      tailorShipment.status = ShipmentStatus.FAILED;
    }

    // 3) Refund = the tailor's item totals + the external-fabric value the
    //    customer paid the fabric vendor + both shipping legs.
    const tailorItems = tailorId
      ? order.items.filter((i) => i.business?.toString() === tailorId)
      : [];
    const tailorItemsTotal = tailorItems.reduce(
      (sum, i) => sum + (i.total_price || 0),
      0,
    );
    const externalFabricTotal = tailorItems.reduce(
      (sum, i) => sum + ((i as any).pricing?.external_fabric || 0),
      0,
    );
    const fabricShippingFee = fabricShipment.shipping_fee || 0;
    const tailorShippingFee = tailorShipment?.shipping_fee || 0;
    const refundAmount =
      tailorItemsTotal +
      externalFabricTotal +
      fabricShippingFee +
      tailorShippingFee;

    // 4) Adjust order totals for the cancelled portion.
    order.subtotal = Math.max(0, (order.subtotal || 0) - tailorItemsTotal);
    order.shipping_fee = Math.max(
      0,
      (order.shipping_fee || 0) - fabricShippingFee - tailorShippingFee,
    );
    order.total = Math.max(0, (order.total || 0) - refundAmount);

    // 5) Cancel the order only if nothing active remains; else keep it moving.
    const orderCancelled = order.shipments.every((s) => s.rejected);
    if (orderCancelled) {
      order.status = OrderStatus.CANCELLED;
      (order as any).refund_status = 'refunded';
    } else {
      const active = order.shipments.filter((s) => !s.rejected);
      if (active.length && active.every((s) => s.confirmed)) {
        order.status = OrderStatus.PROCESSING;
      }
    }

    order.markModified('shipments');
    await order.save();

    // 6) Refund the customer (wallet, or Paystack → wallet).
    await this.processPartialRefund(order, refundAmount, reason).catch((err) =>
      this.logger.error(
        `[FabricReject] Refund failed for ${order.reference}: ${err.message}`,
      ),
    );

    // 7) Reverse the fabric vendor's and the tailor's earnings for this order.
    await this.reverseBusinessEarnings(order, fabricVendorId).catch((err) =>
      this.logger.error(
        `[FabricReject] Fabric-vendor earnings reversal failed for ${order.reference}: ${err.message}`,
      ),
    );
    if (tailorId) {
      await this.reverseBusinessEarnings(order, tailorId).catch((err) =>
        this.logger.error(
          `[FabricReject] Tailor earnings reversal failed for ${order.reference}: ${err.message}`,
        ),
      );
    }

    // 8) Restore the tailor's item stock + the applied fabric (both live on the
    //    tailor's items, so a tailor-scoped restore covers them; the fabric
    //    vendor owns no order items).
    if (tailorId) {
      await this.productService
        .restoreInventory(order._id as Types.ObjectId, tailorId)
        .catch((err) =>
          this.logger.error(
            `[FabricReject] Inventory restore failed for ${order.reference}: ${err.message}`,
          ),
        );
    }

    return { refundAmount, orderCancelled };
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
        let fabricHandled = false;

        for (const shipment of order.shipments) {
          // Skip already confirmed or rejected shipments
          if (shipment.confirmed || shipment.rejected) continue;

          // An unconfirmed FABRIC TRANSFER means the garment can't be made —
          // cancel the whole order (full refund, restore all stock incl. applied
          // fabric, reverse all earnings) rather than a per-vendor slice. Claim
          // the shipment's `refunded` flag first so overlapping cron runs can't
          // double-refund.
          if (shipment.shipment_type === ShipmentType.FABRIC_TRANSFER) {
            const claim = await this.orderModel.updateOne(
              {
                _id: order._id,
                status: { $ne: OrderStatus.CANCELLED },
                shipments: {
                  $elemMatch: {
                    _id: (shipment as any)._id,
                    refunded: { $ne: true },
                  },
                },
              },
              { $set: { 'shipments.$.refunded': true } },
            );
            if (claim.modifiedCount !== 1) continue;
            (shipment as any).refunded = true;

            const business = await this.businessModel.findById(shipment.business);
            const businessName = business?.business_name || 'The fabric vendor';
            const { refundAmount, orderCancelled } =
              await this.unwindRejectedFabricTransfer(
                order as OrderDocument,
                shipment,
                'Auto-rejected: fabric vendor did not confirm within 24 hours',
              );
            this.notificationsService
              .create({
                recipient: order.customer.toString(),
                category: NotificationCategory.ORDER,
                type: NotificationType.ORDER_CANCELLED,
                title: orderCancelled ? 'Order Cancelled' : 'Item Cancelled',
                body: orderCancelled
                  ? `${businessName} did not confirm the fabric for your order #${order.reference} within 24 hours. The order was cancelled and ₦${refundAmount.toLocaleString()} refunded to your wallet.`
                  : `${businessName} did not confirm the fabric for your order #${order.reference} within 24 hours. The affected garment was cancelled and ₦${refundAmount.toLocaleString()} refunded to your wallet; the rest of your order is unaffected.`,
                metadata: {
                  order_id: order._id,
                  order_reference: order.reference,
                  business_name: businessName,
                  refund_amount: refundAmount,
                  reason: 'auto_reject_fabric_transfer',
                },
                action_url: `/orders`,
              })
              .catch((err) =>
                this.logger.error(`[AutoReject] Failed to notify customer: ${err.message}`),
              );

            fabricHandled = true;
            break; // whole order cancelled — stop processing its other shipments
          }

          // Auto-reject this vendor's unconfirmed shipment
          shipment.rejected = true;
          shipment.rejected_at = new Date();
          shipment.rejection_reason = 'Auto-rejected: vendor did not confirm within 24 hours';
          shipment.status = ShipmentStatus.FAILED;
          orderChanged = true;

          // Calculate refund for this vendor's portion (skip items already
          // rejected individually — they were refunded + restocked already).
          const vendorItems = order.items.filter(
            (i) =>
              i.business?.toString() === shipment.business.toString() &&
              !(i as any).rejected,
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

        // A fabric-transfer rejection already unwound + saved the affected part
        // of the order and set its status; don't re-derive it below (which could
        // flip it back). Other stale shipments get picked up on the next run.
        if (fabricHandled) continue;

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
          // Preferred: id is the INNER size-variant _id.
          for (const cv of product.clothing?.color_variants || []) {
            const v = cv.variants?.find(
              (x: any) => String(x._id) === String(variantId),
            );
            if (v) {
              stock = v.stock ?? 0;
              break;
            }
          }
          // Fallback: id is the OUTER colour variant → check the selected size.
          if (stock === undefined) {
            const outer = (product.clothing?.color_variants || []).find(
              (cv: any) => String(cv._id) === String(variantId),
            );
            if (outer) {
              const v =
                (cvs?.size
                  ? outer.variants?.find(
                      (x: any) =>
                        x.size?.toLowerCase() === String(cvs.size).toLowerCase(),
                    )
                  : undefined) ??
                (outer.variants?.length === 1 ? outer.variants[0] : undefined);
              if (v) stock = v.stock ?? 0;
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

      // Build items for this vendor only (skip any rejected individually — they
      // aren't being shipped).
      const vendorItems = order.items.filter(
        (i) => i.business?.toString() === businessId && !(i as any).rejected,
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

  // ==================== ADMIN DASHBOARD CHARTS ====================
  //
  // Platform-wide counterpart to getBusinessChart(). Same envelope the vendor
  // app already consumes — `{ summary, charts: { <name>: { chartType, title,
  // series: [{ key, name, color?, data: [{ label, value, color? }] }] } } }` —
  // so the admin console can reuse the vendor chart readers verbatim.
  //
  // The previous platform helpers (getChart / getOrdersByGenderChart /
  // getOrdersByLocationChart / getOrdersByProductChart) were never routed by
  // any controller, and read `users.gender` / `users.address.city` — fields the
  // vendor charts deliberately abandoned because they are almost always unset
  // and, for gender, describe the buyer rather than who the garment is for.
  // They are replaced here by the sources the vendor charts settled on:
  // product taxonomy audience, and the ORDER's shipping state.

  /** Months are 1-indexed in `$month`; the axis always reads Jan…Dec. */
  private static readonly MONTH_LABELS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  /**
   * Expand a `{ _id: <1-12>, value }` aggregation into a dense twelve-point
   * series, so a month with no orders is an explicit 0 rather than a gap.
   */
  private static toMonthlySeries(
    rows: { _id: number; value: number }[],
  ): { label: string; value: number }[] {
    return OrderService.MONTH_LABELS.map((label, index) => {
      const row = rows.find((r) => r._id === index + 1);
      // Money is summed in naira; round to kobo so floating-point addition
      // doesn't surface as 156921.99000000002 on the card.
      return { label, value: row ? Math.round(row.value * 100) / 100 : 0 };
    });
  }

  /** UTC bounds of `year` — matches how Mongo stores `createdAt`. */
  private static yearRange(year: number): { $gte: Date; $lt: Date } {
    return {
      $gte: new Date(Date.UTC(year, 0, 1)),
      $lt: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  /** `$dayOfWeek` is 1=Sun … 7=Sat. */
  private static readonly DAY_LABELS = [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
  ];

  /** Dense seven-point Sun–Sat series from a `{ _id: <1-7>, value }` roll-up. */
  private static toWeekdaySeries(
    rows: { _id: number; value: number }[],
  ): { label: string; value: number }[] {
    return OrderService.DAY_LABELS.map((label, index) => {
      const row = rows.find((r) => r._id === index + 1);
      return { label, value: row ? Math.round(row.value * 100) / 100 : 0 };
    });
  }

  /**
   * Revenue by day of the week, all-time. The weekly-rhythm counterpart to
   * revenueByMonth — which day of the week the marketplace actually sells on.
   * Same weekday bucketing the vendor dashboard uses for its Earnings card.
   */
  async getPlatformEarningsByDayChart(): Promise<{ data: ChartDto }> {
    const rows = await this.orderModel.aggregate<{
      _id: number;
      value: number;
    }>([
      { $match: { payment_status: 'paid' } },
      {
        $group: {
          _id: {
            $dayOfWeek: {
              date: '$createdAt',
              timezone: OrderService.PLATFORM_TZ,
            },
          },
          value: { $sum: '$total' },
        },
      },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Earnings',
        series: [
          {
            key: 'earnings',
            name: 'Earnings',
            color: '#c4b5a0',
            data: OrderService.toWeekdaySeries(rows),
          },
        ],
      },
    };
  }

  /** Order volume by day of the week, all-time. Every order, paid or not. */
  async getPlatformOrderCountByDayChart(): Promise<{ data: ChartDto }> {
    const rows = await this.orderModel.aggregate<{
      _id: number;
      value: number;
    }>([
      {
        $group: {
          _id: {
            $dayOfWeek: {
              date: '$createdAt',
              timezone: OrderService.PLATFORM_TZ,
            },
          },
          value: { $sum: 1 },
        },
      },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Order Count',
        series: [
          {
            key: 'order_count',
            name: 'Orders',
            color: '#c4b5a0',
            data: OrderService.toWeekdaySeries(rows),
          },
        ],
      },
    };
  }

  /**
   * The admin dashboard bundle. `year` scopes every time series; the
   * distribution charts (audience / location / status / product kind) are
   * all-time, matching the counters on GET /admin/dashboard.
   */
  async getAdminChart(year?: number): Promise<AdminDashboardChartsDto> {
    // Default to the latest year that actually has an order, not the wall
    // clock: a staging database whose newest order is from last year would
    // otherwise render twelve empty months.
    const resolvedYear = year ?? (await this.latestOrderYear());

    const [
      revenueByMonth,
      orderCountByMonth,
      earningsByDay,
      orderCountByDay,
      ordersByStatus,
      ordersByAudience,
      ordersByLocation,
      ordersByProductKind,
      expectedEarnings,
    ] = await Promise.all([
      this.getPlatformRevenueByMonthChart(resolvedYear),
      this.getPlatformOrderCountByMonthChart(resolvedYear),
      this.getPlatformEarningsByDayChart(),
      this.getPlatformOrderCountByDayChart(),
      this.getPlatformOrdersByStatusChart(),
      this.getPlatformOrdersByAudienceChart(),
      this.getPlatformOrdersByLocationChart(),
      this.getPlatformOrdersByProductKindChart(),
      this.getPlatformExpectedEarningsChart(),
    ]);

    // Headline figures the charts are annotated with, so the client never has
    // to re-sum a series to render the number above it.
    const revenueSeries = revenueByMonth.data.series[0].data;
    const totalRevenue = revenueSeries.reduce(
      (sum, point) => sum + point.value,
      0,
    );

    return {
      year: resolvedYear,
      currency: 'NGN',
      summary: {
        revenueThisYear: Math.round(totalRevenue * 100) / 100,
        ordersThisYear: orderCountByMonth.data.series[0].data.reduce(
          (sum, point) => sum + point.value,
          0,
        ),
        expectedEarnings: expectedEarnings.data.total,
      },
      charts: {
        revenueByMonth: revenueByMonth.data,
        orderCountByMonth: orderCountByMonth.data,
        earningsByDay: earningsByDay.data,
        orderCountByDay: orderCountByDay.data,
        ordersByStatus: ordersByStatus.data,
        ordersByAudience: ordersByAudience.data,
        ordersByLocation: ordersByLocation.data,
        ordersByProductKind: ordersByProductKind.data,
        expectedEarnings: expectedEarnings.data,
      },
    };
  }

  /**
   * Calendar year of the most recent order; the current year when there are
   * none. Pass a customer to scope it to their own order history.
   */
  private async latestOrderYear(customer?: Types.ObjectId): Promise<number> {
    const [newest] = await this.orderModel
      .find(customer ? { customer } : {})
      .sort({ createdAt: -1 })
      .select('createdAt')
      .limit(1)
      .lean();

    const createdAt = (newest as { createdAt?: Date } | undefined)?.createdAt;
    return createdAt
      ? new Date(createdAt).getUTCFullYear()
      : new Date().getUTCFullYear();
  }

  /**
   * Revenue per month from orders the customer actually paid for. Gross: taken
   * before refunds, commission and payouts, so it agrees with `gross_sales` on
   * GET /admin/dashboard.
   */
  async getPlatformRevenueByMonthChart(
    year: number,
  ): Promise<{ data: ChartDto }> {
    const rows = await this.orderModel.aggregate<{
      _id: number;
      value: number;
    }>([
      {
        $match: {
          payment_status: 'paid',
          createdAt: OrderService.yearRange(year),
        },
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          value: { $sum: '$total' },
        },
      },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Revenue by Month',
        series: [
          {
            key: 'revenue',
            name: 'Revenue',
            color: '#3d2817',
            data: OrderService.toMonthlySeries(rows),
          },
        ],
      },
    };
  }

  /** Order volume per month — every order, paid or not. */
  async getPlatformOrderCountByMonthChart(
    year: number,
  ): Promise<{ data: ChartDto }> {
    const rows = await this.orderModel.aggregate<{
      _id: number;
      value: number;
    }>([
      { $match: { createdAt: OrderService.yearRange(year) } },
      { $group: { _id: { $month: '$createdAt' }, value: { $sum: 1 } } },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Order Count by Month',
        series: [
          {
            key: 'order_count',
            name: 'Orders',
            color: '#c4b5a0',
            data: OrderService.toMonthlySeries(rows),
          },
        ],
      },
    };
  }

  /**
   * Every order grouped by delivery status, highest first. All seven statuses
   * are emitted even at zero so the legend is stable between refreshes.
   */
  async getPlatformOrdersByStatusChart(): Promise<{ data: ChartDto }> {
    const rows = await this.orderModel.aggregate<{
      _id: string;
      count: number;
    }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]);

    const STATUS_COLORS: Record<string, string> = {
      [OrderStatus.PENDING]: '#d4c5b9',
      [OrderStatus.IN_REVIEW]: '#c4b5a0',
      [OrderStatus.PROCESSING]: '#9C8578',
      [OrderStatus.IN_TRANSIT]: '#6b5644',
      [OrderStatus.COMPLETED]: '#3d2817',
      [OrderStatus.CANCELLED]: '#b0b0b0',
      [OrderStatus.RETURNED]: '#8a8a8a',
    };

    const humanise = (status: string) =>
      status
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());

    const data = Object.values(OrderStatus)
      .map((status) => ({
        label: humanise(status),
        value: rows.find((row) => row._id === status)?.count ?? 0,
        color: STATUS_COLORS[status],
      }))
      .sort((a, b) => b.value - a.value);

    return {
      data: {
        chartType: 'pie',
        title: 'Orders by Status',
        series: [{ key: 'status', name: 'Status', data }],
      },
    };
  }

  /**
   * Which audience the sold garments target, read from the product's taxonomy
   * rather than the buyer's profile gender. Platform-wide twin of
   * getBusinessOrdersByGenderChart.
   */
  async getPlatformOrdersByAudienceChart(): Promise<{ data: ChartDto }> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
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

    const bucketFor = (raw: string): 'Men' | 'Women' | 'Unisex' => {
      const g = (raw || '').toLowerCase();
      if (['men', 'male', 'man', 'boys'].includes(g)) return 'Men';
      if (['women', 'female', 'woman', 'girls'].includes(g)) return 'Women';
      return 'Unisex'; // unisex, blank, or anything unrecognised
    };
    const buckets = new Map<string, number>();
    for (const d of data) {
      const bucket = bucketFor(d._id as string);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + d.count);
    }

    const COLORS: Record<string, string> = {
      Men: '#3d2817',
      Women: '#d4c5b9',
      Unisex: '#9C8578',
    };

    return {
      data: {
        chartType: 'pie',
        title: 'Orders by Audience',
        series: [
          {
            key: 'audience',
            name: 'Audience',
            data: ['Men', 'Women', 'Unisex']
              .filter((bucket) => (buckets.get(bucket) ?? 0) > 0)
              .map((bucket) => ({
                label: bucket,
                value: buckets.get(bucket)!,
                color: COLORS[bucket],
              })),
          },
        ],
      },
    };
  }

  /**
   * Top states by order count, from the ORDER's shipping address rather than
   * the customer's profile address. Platform-wide twin of
   * getBusinessOrdersByLocationChart.
   */
  async getPlatformOrdersByLocationChart(): Promise<{ data: ChartDto }> {
    const data = await this.orderModel.aggregate([
      {
        $group: {
          // Normalise: trim, and treat null/missing/blank state as 'Unknown'
          // so a blank state doesn't render as an empty, unlabelled bar.
          _id: {
            $let: {
              vars: {
                s: { $trim: { input: { $ifNull: ['$address.state', ''] } } },
              },
              in: { $cond: [{ $eq: ['$$s', ''] }, 'Unknown', '$$s'] },
            },
          },
          count: { $sum: 1 },
        },
      },
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

  /** Accessory / Custom / Fabric / Non-Custom split, platform-wide. */
  async getPlatformOrdersByProductKindChart(): Promise<{ data: ChartDto }> {
    const data = await this.orderModel.aggregate([
      { $unwind: '$items' },
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
                {
                  case: { $eq: ['$product_info.kind', 'accessory'] },
                  then: 'Accessory',
                },
                {
                  case: { $eq: ['$product_info.kind', 'fabric'] },
                  then: 'Fabric',
                },
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
      { $group: { _id: '$product_category', count: { $sum: 1 } } },
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
              label: (d._id as string) || 'Unknown',
              value: d.count,
            })),
          },
        ],
      },
    };
  }

  /**
   * "Expected earnings": platform commission that is booked against an order
   * but not yet released to the vendor — the same BusinessEarning population
   * BusinessService.getUpcomingEarnings pages through, summed platform-wide and
   * bucketed by the month it is due to release.
   *
   * This is a forward-looking figure taken from money already committed, NOT a
   * forecast: nothing here extrapolates from past orders.
   *
   * Earnings whose release_date is still null (delivery hasn't happened, so the
   * payout clock hasn't started) are real commission but have no month to sit
   * in. They are counted in `total` and reported separately as `unscheduled`,
   * rather than being silently dropped or parked in an arbitrary month.
   */
  async getPlatformExpectedEarningsChart(): Promise<{
    data: ExpectedEarningsChartDto;
  }> {
    const [rows, unscheduled] = await Promise.all([
      this.businessEarningsModel.aggregate<{
        _id: { year: number; month: number };
        value: number;
      }>([
        { $match: { released: false, release_date: { $ne: null } } },
        {
          $group: {
            _id: {
              year: { $year: '$release_date' },
              month: { $month: '$release_date' },
            },
            value: { $sum: '$commission' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      this.businessEarningsModel.aggregate<{ _id: null; value: number }>([
        { $match: { released: false, release_date: null } },
        { $group: { _id: null, value: { $sum: '$commission' } } },
      ]),
    ]);

    // Chronological across year boundaries — a December release and the
    // following January must not collapse onto the same bar.
    const data = rows.map((row) => ({
      label: `${OrderService.MONTH_LABELS[row._id.month - 1]} ${row._id.year}`,
      value: Math.round(row.value * 100) / 100,
    }));

    const unscheduledTotal =
      Math.round((unscheduled[0]?.value ?? 0) * 100) / 100;
    const scheduledTotal = data.reduce((sum, point) => sum + point.value, 0);

    return {
      data: {
        chartType: 'bar',
        title: 'Expected Earnings',
        total: Math.round((scheduledTotal + unscheduledTotal) * 100) / 100,
        unscheduled: unscheduledTotal,
        currency: 'NGN',
        series: [
          {
            key: 'expected_earnings',
            name: 'Expected Earnings',
            color: '#3d2817',
            data,
          },
        ],
      },
    };
  }

  // ==================== ADMIN PROFILE OVERVIEW ====================
  //
  // Backs the admin console's profile drawer. Two of the design's figures are
  // platform-wide (the marketplace this admin oversees) and the rest are that
  // admin's own workload, so the payload keeps them in separate groups rather
  // than one flat bag where "vendors" and "vendors managed" read alike.
  //
  // "Task" here means an assigned support ticket. There is no separate task or
  // audit-log collection in this backend, and tickets are the only work the
  // platform actually assigns to an admin — they carry an assignee, a status
  // that maps cleanly onto the design's Completed/Pending tabs, and a vendor.

  /** A ticket in one of these statuses is finished work. */
  private static readonly DONE_TICKET_STATUSES = [
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ];

  /** The design's "Task Last Month" window. */
  private static readonly TASK_WINDOW_DAYS = 30;

  /** How many tasks the drawer lists. */
  private static readonly TASK_LIMIT = 10;

  async getAdminProfileOverview(
    adminId: string,
  ): Promise<AdminProfileOverviewDto> {
    if (!Types.ObjectId.isValid(adminId)) {
      throw new BadRequestException('Invalid admin id');
    }
    const admin = new Types.ObjectId(adminId);

    const since = new Date();
    since.setDate(since.getDate() - OrderService.TASK_WINDOW_DAYS);

    const done = { $in: OrderService.DONE_TICKET_STATUSES };

    const [
      dashboard,
      ticketsClosed,
      ticketsResolvedByMe,
      tasksCompletedThisMonth,
      vendorsManaged,
      tasks,
    ] = await Promise.all([
      // Reuses the dashboard roll-up rather than re-counting customers,
      // vendors and gross sales — the drawer and the dashboard cards can then
      // never disagree.
      this.getAdminDashboardMetrics(),
      this.ticketModel.countDocuments({ status: done }),
      this.ticketModel.countDocuments({ assigned_to: admin, status: done }),
      // Deliberately a narrower figure than ticketsResolved: the drawer shows
      // both, and two identical numbers under different labels would look like
      // a bug.
      this.ticketModel.countDocuments({
        assigned_to: admin,
        status: done,
        updatedAt: { $gte: since },
      }),
      // "Vendors managed" — no business carries an assigned admin, so this is
      // the vendors this admin has actually handled a ticket for.
      this.ticketModel
        .distinct('business', { assigned_to: admin })
        .then((ids) => ids.filter(Boolean).length),
      // `timestamps: true` adds createdAt but the Ticket class does not declare
      // it, so the lean result is typed explicitly rather than cast at the use
      // site.
      this.ticketModel
        .find({ assigned_to: admin, createdAt: { $gte: since } })
        .select('issue_type status business createdAt')
        .populate('business', 'business_name')
        .sort({ createdAt: -1 })
        .limit(OrderService.TASK_LIMIT)
        .lean<
          {
            _id: Types.ObjectId;
            issue_type: string;
            status: TicketStatus;
            business?: { business_name?: string } | null;
            createdAt: Date;
          }[]
        >(),
    ]);

    return {
      currency: 'NGN',
      taskWindowDays: OrderService.TASK_WINDOW_DAYS,
      stats: {
        customers: dashboard.total_customers,
        vendors: dashboard.total_vendors,
        tasksCompleted: tasksCompletedThisMonth,
        ticketsClosed,
      },
      metrics: {
        vendorsManaged,
        ticketsResolved: ticketsResolvedByMe,
        totalSalesOversight: dashboard.gross_sales,
      },
      tasks: tasks.map((ticket) => ({
        id: String(ticket._id),
        // issue_type is the ticket's headline; the description is the body and
        // is far too long for a drawer row.
        title: ticket.issue_type,
        vendor: ticket.business?.business_name ?? null,
        status: OrderService.DONE_TICKET_STATUSES.includes(ticket.status)
          ? ('completed' as const)
          : ('pending' as const),
        // The client renders this as "5d ago", so it needs the raw instant.
        at: ticket.createdAt,
      })),
    };
  }

  // ==================== ADMIN CUSTOMER ANALYTICS ====================
  //
  // Per-customer counterpart to getAdminChart(), for the admin console's
  // customer detail page. Same `{ chartType, title, series }` envelope.
  //
  // Every card in that page's analytics row used to be fabricated: a hardcoded
  // gross-sales figure, a 55/45 returns split, and an hourly traffic curve
  // peaking at 50,000 sessions — for a single customer. Worse, the earnings and
  // recent-orders cards were reading PLATFORM-wide data on a page about one
  // person. These charts are scoped to the customer or they don't render.

  /** Hour-of-day labels, in the platform's timezone (see PLATFORM_TZ). */
  private static readonly HOUR_LABELS = Array.from(
    { length: 24 },
    (_, hour) => {
      if (hour === 0) return '12am';
      if (hour === 12) return '12pm';
      return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
    },
  );

  // The marketplace is Nigerian and the payout cron already runs on Lagos time.
  // Bucketing activity in UTC would shift every bar an hour and put "evening
  // browsing" in the wrong part of the day.
  private static readonly PLATFORM_TZ = 'Africa/Lagos';

  /**
   * Order history, spend and on-platform activity for one customer.
   *
   * `year` scopes the spend series only; the distributions and the summary are
   * all-time, so the headline figures match the customer's lifetime record.
   */
  async getCustomerAnalytics(
    customerId: string,
    year?: number,
  ): Promise<CustomerAnalyticsDto> {
    if (!Types.ObjectId.isValid(customerId)) {
      throw new BadRequestException('Invalid customer id');
    }
    const customer = new Types.ObjectId(customerId);

    const resolvedYear = year ?? (await this.latestOrderYear(customer));

    const [
      summary,
      spendByMonth,
      ordersByProductKind,
      returnsRate,
      activityByHour,
    ] = await Promise.all([
      this.getCustomerOrderSummary(customer),
      this.getCustomerSpendByMonthChart(customer, resolvedYear),
      this.getCustomerOrdersByProductKindChart(customer),
      this.getCustomerReturnsRateChart(customer),
      this.getCustomerActivityByHourChart(customerId),
    ]);

    return {
      customer: customerId,
      year: resolvedYear,
      currency: 'NGN',
      summary,
      charts: {
        spendByMonth: spendByMonth.data,
        ordersByProductKind: ordersByProductKind.data,
        returnsRate: returnsRate.data,
        activityByHour: activityByHour.data,
      },
    };
  }

  /** Lifetime order count, spend and last-order date for one customer. */
  private async getCustomerOrderSummary(
    customer: Types.ObjectId,
  ): Promise<CustomerAnalyticsSummaryDto> {
    const [row] = await this.orderModel.aggregate<{
      totalOrders: number;
      totalSpent: number;
      paidOrders: number;
      returnedOrders: number;
      lastOrderAt: Date | null;
    }>([
      { $match: { customer } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          // Spend is what the customer actually paid, so an abandoned unpaid
          // order does not inflate their lifetime value.
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ['$payment_status', 'paid'] },
                { $ifNull: ['$total', 0] },
                0,
              ],
            },
          },
          paidOrders: {
            $sum: { $cond: [{ $eq: ['$payment_status', 'paid'] }, 1, 0] },
          },
          returnedOrders: {
            $sum: {
              $cond: [
                { $in: ['$refund_status', ['partial', 'refunded']] },
                1,
                0,
              ],
            },
          },
          lastOrderAt: { $max: '$createdAt' },
        },
      },
    ]);

    // Return rate is against PAID orders: an order that was never paid for
    // could not have been returned, and counting it would deflate the rate.
    const paidOrders = row?.paidOrders ?? 0;
    const returnedOrders = row?.returnedOrders ?? 0;

    return {
      totalOrders: row?.totalOrders ?? 0,
      totalSpent: Math.round((row?.totalSpent ?? 0) * 100) / 100,
      returnedOrders,
      returnRate:
        paidOrders === 0
          ? 0
          : Math.round((returnedOrders / paidOrders) * 1000) / 10,
      lastOrderAt: row?.lastOrderAt ?? null,
    };
  }

  /** What this customer paid, per month of `year`. */
  private async getCustomerSpendByMonthChart(
    customer: Types.ObjectId,
    year: number,
  ): Promise<{ data: ChartDto }> {
    const rows = await this.orderModel.aggregate<{
      _id: number;
      value: number;
    }>([
      {
        $match: {
          customer,
          payment_status: 'paid',
          createdAt: OrderService.yearRange(year),
        },
      },
      { $group: { _id: { $month: '$createdAt' }, value: { $sum: '$total' } } },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Spend by Month',
        series: [
          {
            key: 'spend',
            name: 'Spend',
            color: '#c4b5a0',
            data: OrderService.toMonthlySeries(rows),
          },
        ],
      },
    };
  }

  /** Accessory / Custom / Fabric / Non-Custom split of this customer's orders. */
  private async getCustomerOrdersByProductKindChart(
    customer: Types.ObjectId,
  ): Promise<{ data: ChartDto }> {
    const data = await this.orderModel.aggregate<{
      _id: string;
      count: number;
    }>([
      { $match: { customer } },
      { $unwind: '$items' },
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
                {
                  case: { $eq: ['$product_info.kind', 'accessory'] },
                  then: 'Accessory',
                },
                {
                  case: { $eq: ['$product_info.kind', 'fabric'] },
                  then: 'Fabric',
                },
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
                      {
                        $eq: ['$product_info.clothing.type', 'non_customize'],
                      },
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
      { $group: { _id: '$product_category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return {
      data: {
        chartType: 'pie',
        title: 'Orders by Product Type',
        series: [
          {
            key: 'product_kind',
            name: 'Product Type',
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
   * Returned vs kept across this customer's PAID orders.
   *
   * Emits nothing at all when they have no paid orders — a 0% return rate for
   * someone who has never completed a purchase is not a fact about them, and
   * the card should show its empty template instead.
   */
  private async getCustomerReturnsRateChart(
    customer: Types.ObjectId,
  ): Promise<{ data: ChartDto }> {
    const [row] = await this.orderModel.aggregate<{
      paid: number;
      returned: number;
    }>([
      { $match: { customer, payment_status: 'paid' } },
      {
        $group: {
          _id: null,
          paid: { $sum: 1 },
          returned: {
            $sum: {
              $cond: [
                { $in: ['$refund_status', ['partial', 'refunded']] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const paid = row?.paid ?? 0;
    const returned = row?.returned ?? 0;

    return {
      data: {
        chartType: 'pie',
        title: 'Returns Rate',
        series: [
          {
            key: 'returns',
            name: 'Returns',
            data: paid
              ? [
                  { label: 'Returned', value: returned, color: '#3d2817' },
                  { label: 'Kept', value: paid - returned, color: '#d4c5b9' },
                ]
              : [],
          },
        ],
      },
    };
  }

  /**
   * When this customer is active, by hour of day, from the recommendations
   * `events` collection.
   *
   * NOTE: nothing in this backend writes to that collection — events arrive
   * only from clients POSTing /recommendations/events. Until a client does, the
   * series is a flat 24 zeroes and the card renders its empty template. That is
   * the honest outcome; the hardcoded curve this replaced peaked at 50,000
   * "sessions" for a single customer.
   */
  private async getCustomerActivityByHourChart(
    customerId: string,
  ): Promise<{ data: ChartDto }> {
    const rows = await this.eventModel.aggregate<{
      _id: number;
      value: number;
    }>([
      { $match: { userId: customerId } },
      {
        $group: {
          _id: {
            $hour: {
              date: '$timestamp',
              timezone: OrderService.PLATFORM_TZ,
            },
          },
          value: { $sum: 1 },
        },
      },
    ]);

    return {
      data: {
        chartType: 'bar',
        title: 'Activity by Time of Day',
        series: [
          {
            key: 'activity',
            name: 'Activity',
            color: '#8a7060',
            // All 24 hours, so the x-axis is a full day rather than only the
            // hours this customer happened to be online.
            data: OrderService.HOUR_LABELS.map((label, hour) => ({
              label,
              value: rows.find((row) => row._id === hour)?.value ?? 0,
            })),
          },
        ],
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
