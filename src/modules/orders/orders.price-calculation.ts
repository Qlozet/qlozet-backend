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
  AddonSelectionDto,
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

    // Note: Tax and platform discounts removed.
    // Shipping is handled externally via Shipbubble.
    // Product-level discounts are already applied in calculateItemTotal().
    const total = subtotal;

    return {
      subtotal: this.round(subtotal),
      total: this.round(total),
      itemBreakdown,
    };
  }

  async calculateItemTotal(item: ProcessedOrderItem): Promise<number> {
    const product = await this.productModel.findById(item.product_id);

    if (!product) {
      throw new NotFoundException(`Product not found: ${item.product_id}`);
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
          item,
        );
        break;

      default:
        total = 0;
    }

    const finalTotal = Number(total) || 0;

    this.logger.debug(
      `🧾 Product ${product._id} (${product.kind}) => Final total: ${finalTotal}`,
    );

    return finalTotal;
  }

  private normalizeSelections(
    selections: NormalizedSelections,
  ): NormalizedSelections {
    if (!selections) {
      return {
        color_variant_selection: [],
        style_selection: [],
        fabric_selection: [],
        accessory_selection: [],
        addon_selection: [],
      };
    }

    return {
      color_variant_selection:
        selections.color_variant_selection ??
        selections.color_variant_selection ??
        [],
      style_selection:
        selections.style_selection ?? selections.style_selection ?? [],
      fabric_selection:
        selections.fabric_selection ?? selections.fabric_selection ?? [],
      accessory_selection:
        selections.accessory_selection ?? selections.accessory_selection ?? [],
      addon_selection:
        selections.addon_selection ?? [],
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
        total += style.price * (s.quantity ?? 1);
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

    const qty = item.quantity ?? 1;
    // Always use base_price for calculation; discounts are applied to the FULL total at the end
    const basePrice = product.base_price || 0;

    if (product.clothing?.type === 'customize') {
      // Use item-level quantity for base price (craftsmanship cost).
      // Component quantities (accessories, fabrics, etc.) only multiply their own prices.
      total += basePrice * qty;
    } else {
      // Ready-to-wear: if no color variants are selected, add base price
      // For ready-to-wear, use discounted_price if available (pre-existing behavior)
      const effectivePrice = (product.discounted_price != null && product.discounted_price > 0 && product.discounted_price < product.base_price)
        ? product.discounted_price
        : (product.base_price || 0);
      if (!selections.color_variant_selection || selections.color_variant_selection.length === 0) {
        total += effectivePrice * qty;
      }
    }

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
    if (selections.color_variant_selection)
      total += await this.calculateColorVariantCost(
        selections.color_variant_selection,
        product,
      );
    if (selections.style_selection)
      total += await this.calculateStyleCost(
        selections.style_selection,
        product,
      );
    if (selections.addon_selection)
      total += this.calculateAddonCost(
        selections.addon_selection,
        product,
      );

    // For customize clothing, apply discount to the FULL total (base + all components)
    if (product.clothing?.type === 'customize' && product.applied_discount) {
      const discount = await this.discountModel?.findById(product.applied_discount).lean();
      if (discount) {
        const discountAmount = this.applyDiscountToTotal(total, discount);
        total = Math.max(0, total - discountAmount);
      }
    }

    return this.round(total);
  }

  /**
   * Itemized pricing breakdown (base, styles, fabric, variant, accessories,
   * add-ons, before-discount, discount, final). `final` always equals
   * calculateItemTotal — this mirrors the same logic — so it is safe to store
   * as a per-item pricing snapshot and display without re-computing.
   */
  async calculateItemBreakdown(item: ProcessedOrderItem): Promise<{
    base: number;
    styles_total: number;
    fabric_total: number;
    variant_total: number;
    accessories_total: number;
    addons_total: number;
    before_discount: number;
    discount: number;
    final: number;
  }> {
    const product = await this.productModel.findById(item.product_id);
    if (!product) {
      throw new NotFoundException(`Product not found: ${item.product_id}`);
    }
    const sel = this.normalizeSelections(item.selections);
    const qty = item.quantity ?? 1;

    const empty = {
      base: 0, styles_total: 0, fabric_total: 0, variant_total: 0,
      accessories_total: 0, addons_total: 0,
    };

    if (product.kind === ProductKind.CLOTHING) {
      const isCustomize = product.clothing?.type === 'customize';
      const effectivePrice =
        product.discounted_price != null &&
        product.discounted_price > 0 &&
        product.discounted_price < product.base_price
          ? product.discounted_price
          : product.base_price || 0;

      let base = 0;
      if (isCustomize) base = (product.base_price || 0) * qty;
      else if (!sel.color_variant_selection?.length) base = effectivePrice * qty;

      const styles = sel.style_selection?.length
        ? await this.calculateStyleCost(sel.style_selection, product)
        : 0;
      const fabric = sel.fabric_selection?.length
        ? await this.calculateFabricCost(sel.fabric_selection, product)
        : 0;
      const accessories = sel.accessory_selection?.length
        ? await this.calculateAccessoryTotal(sel.accessory_selection, product)
        : 0;
      const variant = sel.color_variant_selection?.length
        ? await this.calculateColorVariantCost(sel.color_variant_selection, product)
        : 0;
      const addons = sel.addon_selection?.length
        ? this.calculateAddonCost(sel.addon_selection, product)
        : 0;

      const before = base + styles + fabric + accessories + variant + addons;
      let discount = 0;
      if (isCustomize && product.applied_discount) {
        const d = await this.discountModel?.findById(product.applied_discount).lean();
        if (d) discount = Math.min(this.applyDiscountToTotal(before, d), before);
      }
      const final = Math.max(0, before - discount);
      return {
        base: this.round(base),
        styles_total: this.round(styles),
        fabric_total: this.round(fabric),
        variant_total: this.round(variant),
        accessories_total: this.round(accessories),
        addons_total: this.round(addons),
        before_discount: this.round(before),
        discount: this.round(discount),
        final: this.round(final),
      };
    }

    // Fabric / accessory products — flat price.
    const final = await this.calculateItemTotal(item);
    return {
      ...empty,
      base: final,
      before_discount: final,
      discount: 0,
      final,
    };
  }

  /**
   * Apply a discount to a total amount based on discount type.
   */
  private applyDiscountToTotal(total: number, discount: any): number {
    if (!discount) return 0;

    switch (discount.type) {
      case 'percentage':
      case 'flash_percentage':
      case 'store_wide':
        return (total * (discount.value || 0)) / 100;
      case 'fixed':
      case 'flash_fixed':
        return Math.min(discount.value || 0, total);
      default:
        return 0;
    }
  }

  // ========== FABRIC ==========

  async calculateFabricTotal(
    item: ProcessedOrderItem,
    product: ProductDocument,
  ): Promise<number> {
    const qty = item.quantity ?? 1;
    const effectivePrice = (product.discounted_price != null && product.discounted_price > 0 && product.discounted_price < product.base_price)
      ? product.discounted_price
      : (product.base_price || 0);

    const selections = item.selections?.fabric_selection;
    if (selections && selections.length > 0) {
      return this.round(await this.calculateFabricCost(selections, product));
    }
    return this.round(effectivePrice * qty);
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

        // Auto-resolve yardage from yard_per_order if not provided
        let resolvedYardage = s.yardage;
        if (!resolvedYardage && s.size && fabric.variants?.length) {
          const matchingVariant = fabric.variants.find(
            (v) => v.size?.toLowerCase() === s.size!.toLowerCase(),
          );
          if (matchingVariant?.yard_per_order) {
            resolvedYardage = matchingVariant.yard_per_order;
          }
        }
        if (!resolvedYardage) resolvedYardage = 0;

        if (fabric.min_cut < resolvedYardage) {
          throw new BadRequestException(
            `Minimum cut for fabric "${fabric.name}" is ${fabric.min_cut} yards. You requested ${resolvedYardage} yards.`,
          );
        }

        // Check if there is enough yardage remaining
        if ((fabric.yard_length ?? 0) < resolvedYardage) {
          throw new BadRequestException(
            `Not enough yardage for fabric "${fabric.name}". Remaining: ${fabric.yard_length}`,
          );
        }

        const qty = s.quantity ?? 1;
        const cost = resolvedYardage * fabric.price_per_yard;

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

        // Resolve how many yards this garment needs:
        //  1) explicit yardage on the request,
        //  2) garment-level yardage_per_size (bill of materials, fabric-agnostic),
        //  3) legacy per-fabric variant yard_per_order.
        let resolvedYardage = s.yardage;
        if (!resolvedYardage && s.size) {
          const gy = product.clothing?.yardage_per_size?.find(
            (y) => y.size?.toLowerCase() === s.size!.toLowerCase(),
          );
          if (gy?.yards) resolvedYardage = gy.yards;
        }
        if (!resolvedYardage && s.size && fabric.variants?.length) {
          const matchingVariant = fabric.variants.find(
            (v) => v.size?.toLowerCase() === s.size!.toLowerCase(),
          );
          if (matchingVariant?.yard_per_order) {
            resolvedYardage = matchingVariant.yard_per_order;
          }
        }
        if (!resolvedYardage) resolvedYardage = 0;

        // Fabric is cut in minimums — order at least min_cut. (The previous
        // check errored on legitimate above-minimum requests; it was inverted.)
        if (fabric.min_cut && resolvedYardage > 0 && resolvedYardage < fabric.min_cut) {
          resolvedYardage = fabric.min_cut;
        }
        // Check remaining stock
        if ((fabric.yard_length ?? 0) < resolvedYardage) {
          throw new BadRequestException(
            `Not enough yardage for fabric "${fabric.name}" in clothing. Remaining: ${fabric.yard_length}`,
          );
        }

        const qty = s.quantity ?? 1;
        const cost = resolvedYardage * fabric.price_per_yard;

        total += cost * qty;
      }
    }

    return this.round(total);
  }

  // ========== ACCESSORIES / VARIANTS ==========

  async calculateAccessoryTotal(
    selections: AccessorySelectionDto[],
    product: ProductDocument,
    item?: ProcessedOrderItem,
  ): Promise<number> {
    let total = 0;
    const qty = item?.quantity ?? 1;
    const effectivePrice = (product.discounted_price != null && product.discounted_price > 0 && product.discounted_price < product.base_price)
      ? product.discounted_price
      : (product.base_price || 0);

    if (product.kind === ProductKind.ACCESSORY) {
      if (!selections || selections.length === 0) {
        return this.round(effectivePrice * qty);
      }
    }

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
        const variants = accessory.variants || [];

        if (s.variant_id && variants.length > 0) {
          const variant = variants.find(
            (v) => String(v._id) === String(s.variant_id),
          );

          if (!variant) {
            throw new BadRequestException(
              `Selected variant not found for accessory "${accessory.name}"`,
            );
          }

          if ((variant.stock ?? 0) < (s.quantity ?? 0)) {
            throw new BadRequestException(
              `Not enough stock for variant "${variant._id}" of accessory "${accessory.name}". Remaining: ${variant.stock}`,
            );
          }

          total += (accessory.price ?? 0) * (s.quantity ?? 1);
        }
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
        } else {
          // No variant specified — just add the base accessory price
          total += (accessory.price ?? 0) * (s.quantity ?? 1);
        }
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
        (v) => String(v._id) === String(s.color_variant_id),
      );

      if (!color) {
        throw new BadRequestException('Selected variant not found in clothing');
      }

      // Price ONLY the selected size's variant — not every size of the colour.
      // (The previous loop summed all sizes, multiplying the price by the number
      // of sizes the colour has.)
      const variant = s.size
        ? color.variants.find(
            (v) => v.size?.toLowerCase() === String(s.size).toLowerCase(),
          )
        : color.variants[0];
      if (!variant) continue;

      if ((variant.stock ?? 0) < (s.quantity ?? 0)) {
        throw new BadRequestException(
          `Not enough stock for variant "${variant._id}" in clothing. Remaining: ${variant.stock}`,
        );
      }

      total += (variant.price ?? 0) * (s.quantity ?? 1);
    }

    return this.round(total);
  }

  // ========== ADDONS ==========

  private calculateAddonCost(
    selections: AddonSelectionDto[],
    product: ProductDocument,
  ): number {
    let total = 0;

    if (!product.clothing?.addons?.length) return 0;

    for (const sel of selections) {
      const addon = product.clothing.addons.find(
        (a: any) => String(a._id) === String(sel.addon_id),
      );

      if (!addon) {
        throw new BadRequestException(
          `Selected addon not found on product: ${sel.addon_id}`,
        );
      }

      const variant = addon.variants?.find(
        (v: any) => String(v._id) === String(sel.variant_id),
      );

      if (!variant) {
        throw new BadRequestException(
          `Selected addon variant not found for addon "${addon.name}": ${sel.variant_id}`,
        );
      }

      total += (variant.price ?? 0) * (sel.quantity ?? 1);
    }

    return this.round(total);
  }

  // ========== HELPERS ==========

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
