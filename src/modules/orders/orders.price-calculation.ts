// src/services/price-calculation.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProductDocument,
  StyleDocument,
  FabricDocument,
  AccessoryDocument,
  VariantDocument,
  ClothingDocument,
  Fabric,
  Accessory,
  Variant,
  DiscountDocument,
} from '../products/schemas';
import {
  ProductKind,
  ProcessedOrderItem,
  NormalizedSelections,
} from './schemas/orders.interfaces';
import {
  FabricSelectionDto,
  AccessorySelectionDto,
  VariantSelectionDto,
  StyleSelectionDto,
} from './dto/selection.dto';

@Injectable()
export class PriceCalculationService {
  private readonly logger = new Logger(PriceCalculationService.name);

  constructor(
    @InjectModel('Product')
    private readonly productModel: Model<ProductDocument>,

    @InjectModel('Discount')
    private readonly discountModel: Model<DiscountDocument>,
  ) {}

  // ========== PUBLIC METHODS ==========

  async calculateOrderTotal(items: ProcessedOrderItem[]) {
    const itemBreakdown: Array<{
      item: ProcessedOrderItem;
      calculatedPrice: number;
    }> = [];
    let subtotal = 0;

    for (const item of items) {
      const calculatedPrice = await this.calculateItemTotal(item);
      itemBreakdown.push({ item, calculatedPrice });
      subtotal += calculatedPrice;
    }

    const tax = subtotal * 0.08;
    const shipping = this.calculateShippingCost(items, subtotal);
    const discount = this.calculateDiscount(subtotal);
    const total = subtotal + tax + shipping - discount;

    return {
      subtotal: this.round(subtotal),
      tax: this.round(tax),
      shipping: this.round(shipping),
      discount: this.round(discount),
      total: this.round(total),
      itemBreakdown,
    };
  }

  async calculateItemTotal(item: ProcessedOrderItem): Promise<number> {
    const product = await this.productModel.findById(item.product_id).lean();

    if (!product) {
      throw new NotFoundException(`Product not found: ${item.product_id}`);
    }

    let discountValue = 0;

    // --- Fetch discount if product has applied_discount ---
    if (product.applied_discount) {
      const discount = await this.discountModel
        .findById(product.applied_discount)
        .lean();

      if (discount) {
        discountValue = this.applyDiscount(product, discount);
      }
    }

    // --- Normalize Selections ---
    const normalizedSelections = this.normalizeSelections(item.selections);
    let total = 0;

    // --- Calculate Total Based on Product Type ---
    switch (product.kind) {
      case ProductKind.CLOTHING:
        total = await this.calculateClothingTotal(
          { ...item, selections: normalizedSelections },
          product as ProductDocument,
        );
        break;

      case ProductKind.FABRIC:
        total = await this.calculateFabricTotal(
          { ...item, selections: normalizedSelections },
          product as ProductDocument,
        );
        break;

      case ProductKind.ACCESSORY:
        total = await this.calculateAccessoryTotal(
          normalizedSelections.accessory_selection as AccessorySelectionDto[],
          product as ProductDocument,
        );
        break;

      default:
        total = 0;
    }

    // --- Apply Discount (deduct from total) ---
    const finalTotal = Math.max(total - discountValue, 0);

    this.logger.debug(
      `🧾 Product ${product._id} (${product.kind}) => Base total: ${total}, Discount: ${discountValue}, Final total: ${finalTotal}`,
    );

    return finalTotal;
  }

  private normalizeSelections(
    selections: NormalizedSelections,
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
        selections.variant_selection ?? selections.variant_selection ?? [],
      style_selection:
        selections.style_selection ?? selections.style_selection ?? [],
      fabric_selection:
        selections.fabric_selection ?? selections.fabric_selection ?? [],
      accessory_selection:
        selections.accessory_selection ?? selections.accessory_selection ?? [],
    };
  }
  private applyDiscount(product: ProductDocument, discount: any): number {
    if (!discount || !product?.base_price) return 0;

    const basePrice = product.base_price;
    let discountValue = 0;

    switch (discount.type) {
      /** ---------------- BASIC DISCOUNTS ---------------- */
      case 'percentage':
      case 'flash_percentage':
      case 'store_wide':
        // Percentage-based discounts
        discountValue = (basePrice * (discount.value || 0)) / 100;
        break;

      case 'fixed':
      case 'flash_fixed':
        discountValue = discount.value || 0;
        break;
      case 'category_specific':
        if (discount.categories?.length && product.collections?.length) {
          const match = product.collections.some((cId: any) =>
            discount.categories.includes(String(cId)),
          );
          if (match) {
            if (discount.mode === 'percentage') {
              discountValue = (basePrice * (discount.value || 0)) / 100;
            } else {
              discountValue = discount.value || 0;
            }
          }
        }
        break;

      /** ---------------- DEFAULT ---------------- */
      default:
        discountValue = 0;
        break;
    }
    return Math.min(discountValue, basePrice);
  }

  private async calculateStyleCost(
    selections: StyleSelectionDto[],
    product: ProductDocument,
  ): Promise<number> {
    let total = 0;

    const styles = selections;
    if (!styles) return 0;

    if (product.clothing && product.clothing?.styles) {
      for (const s of styles) {
        const style = product.clothing.styles.find(
          (st) => String(st._id) === String(s.style_id),
        );

        if (!style) {
          throw new BadRequestException(
            `Selected style not found in product: ${s.style_id}`,
          );
        }
        total += style.price;
      }
    }

    return total;
  }

  // ========== CLOTHING ==========

  async calculateClothingTotal(
    item: ProcessedOrderItem,
    product: ProductDocument,
  ): Promise<number> {
    const { selections } = item;
    let total = 0;
    if (selections.fabric_selection)
      total += await this.calculateFabricCost(
        selections.fabric_selection,
        product,
      );
    if (selections.accessory_selection)
      total += await this.calculateAccessoryTotal(
        selections.accessory_selection,
        product,
      );
    if (selections.variant_selection)
      total += await this.calculateColorVariantCost(
        selections.variant_selection,
        product,
      );
    if (selections.style_selection)
      total += await this.calculateStyleCost(
        selections.style_selection,
        product,
      );
    console.log(total, 'TOTAL');
    return this.round(total);
  }

  // ========== FABRIC ==========

  async calculateFabricTotal(
    item: ProcessedOrderItem,
    product: ProductDocument,
  ): Promise<number> {
    const selections = item.selections?.fabric_selection;
    if (selections)
      return this.round(await this.calculateFabricCost(selections, product));
    return 0;
  }

  async calculateFabricCost(
    selections: FabricSelectionDto[],
    product: ProductDocument,
  ): Promise<number> {
    let total = 0;

    for (const s of selections) {
      let fabric: Fabric | undefined;

      if (product.kind === ProductKind.FABRIC) {
        fabric = product.fabric;
        if (!fabric) continue;

        if (String(s.fabric_id) !== String(fabric._id)) {
          throw new BadRequestException(
            'Selected fabric does not exist on product',
          );
        }

        // Check if there is enough yardage remaining
        if ((fabric.yard_length ?? 0) < s.yardage) {
          throw new BadRequestException(
            `Not enough yardage for fabric "${fabric.name}". Remaining: ${fabric.yard_length}`,
          );
        }

        const yardage = s.yardage ?? 0;
        const qty = s.quantity ?? 1;
        const cost = yardage * fabric.price_per_yard;

        total += cost * qty;
      }

      if (product.kind === ProductKind.CLOTHING) {
        // Look for the fabric in the clothing's embedded fabrics
        fabric = product.clothing?.fabrics?.find(
          (f) => String(f._id) === String(s.fabric_id),
        );

        if (!fabric) {
          throw new BadRequestException(
            'Selected fabric not found in clothing',
          );
        }

        // Check remaining yardage
        if ((fabric.yard_length ?? 0) < s.yardage) {
          throw new BadRequestException(
            `Not enough yardage for fabric "${fabric.name}" in clothing. Remaining: ${fabric.yard_length}`,
          );
        }

        const yardage = s.yardage ?? 0;
        const qty = s.quantity ?? 1;
        const cost = yardage * fabric.price_per_yard;

        total += cost * qty;
      }
    }

    return this.round(total);
  }

  // ========== ACCESSORIES / VARIANTS ==========

  async calculateAccessoryTotal(
    selections: AccessorySelectionDto[],
    product: ProductDocument,
  ): Promise<number> {
    let total = 0;

    for (const s of selections) {
      let accessory: Accessory | undefined;

      if (product.kind === ProductKind.ACCESSORY) {
        accessory = product.accessory;
        if (!accessory) continue;

        // Check accessory ID
        if (String(s.accessory_id) !== String(accessory._id)) {
          throw new BadRequestException(
            'Selected accessory does not exist on product',
          );
        }

        // Handle single variant if specified
        const variants = accessory.variants;
        if (s.variant_id && variants.length > 0) {
          for (const v of variants) {
            if (String(v._id) !== String(s.variant_id)) {
              throw new BadRequestException(
                `Selected variant not found for accessory "${accessory.name}"`,
              );
            }

            if ((v.stock ?? 0) < (s.quantity ?? 0)) {
              throw new BadRequestException(
                `Not enough stock for variant "${v._id}" of accessory "${accessory.name}". Remaining: ${v.stock}`,
              );
            }

            total += (accessory.price ?? 0) * (s.quantity ?? 1);
            continue; // already processed
          }
        }

        total += (accessory.price ?? 0) * (s.quantity ?? 1);
      }

      if (product.kind === ProductKind.CLOTHING) {
        accessory = product.clothing?.accessories?.find(
          (acc) => String(acc._id) === String(s.accessory_id),
        );

        if (!accessory) {
          throw new BadRequestException(
            'Selected accessory not found in clothing',
          );
        }

        const variants = accessory.variants;
        if (s.variant_id && variants.length > 0) {
          const variant = variants.find(
            (v) => String(v._id) === String(s.variant_id),
          );

          if (!variant) {
            throw new BadRequestException(
              `Selected variant not found for accessory "${accessory.name}" in clothing`,
            );
          }

          if ((variant.stock ?? 0) < (s.quantity ?? 0)) {
            throw new BadRequestException(
              `Not enough stock for variant "${variant._id}" of accessory "${accessory.name}" in clothing. Remaining: ${variant.stock}`,
            );
          }

          total += (accessory.price ?? 0) * (s.quantity ?? 1);
        }

        total += (accessory.price ?? 0) * (s.quantity ?? 1);
      }
    }

    return this.round(total);
  }

  async calculateColorVariantCost(
    selections: VariantSelectionDto[],
    product: ProductDocument,
  ): Promise<number> {
    let total = 0;

    for (const s of selections) {
      const color = product.clothing?.color_variants?.find(
        (v) => String(v._id) === String(s.variant_id),
      );

      if (!color) {
        throw new BadRequestException('Selected variant not found in clothing');
      }

      // Optional: check stock
      for (const v of color.variants) {
        if ((v.stock ?? 0) < (s.quantity ?? 0)) {
          throw new BadRequestException(
            `Not enough stock for variant "${v._id}" in clothing. Remaining: ${v.stock}`,
          );
        }

        total += (v.price ?? 0) * (s.quantity ?? 1);
      }
    }

    return this.round(total);
  }

  // ========== SHIPPING / DISCOUNT / HELPERS ==========

  private calculateShippingCost(
    items: ProcessedOrderItem[],
    subtotal: number,
  ): number {
    if (subtotal > 200) return 0;
    // const count = items.reduce((sum, i) => sum + i.quantity, 0);
    return 0;
  }

  private calculateDiscount(subtotal: number): number {
    return subtotal > 500 ? subtotal * 0.1 : 0;
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
