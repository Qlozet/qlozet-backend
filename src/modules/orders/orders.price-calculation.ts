// src/services/price-calculation.service.ts
import {
  BadRequestException,
  Injectable,
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
  constructor(
    @InjectModel('Product')
    private readonly productModel: Model<ProductDocument>,
    @InjectModel('Style') private readonly styleModel: Model<StyleDocument>,
    @InjectModel('Fabric') private readonly fabricModel: Model<FabricDocument>,
    @InjectModel('Clothing')
    private readonly clothingModel: Model<ClothingDocument>,
    @InjectModel('Accessory')
    private readonly accessoryModel: Model<AccessoryDocument>,
    @InjectModel('Variant')
    private readonly variantModel: Model<VariantDocument>,
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
    const product = await this.productModel.findById(item.product_id);

    if (!product) {
      throw new NotFoundException(`Product not found: ${item.product_id}`);
    }

    const normalizedSelections = this.normalizeSelections(item.selections);
    switch (product.kind) {
      case ProductKind.CLOTHING:
        return this.calculateClothingTotal(
          {
            ...item,
            selections: normalizedSelections,
          },
          product as ProductDocument,
        );

      case ProductKind.FABRIC:
        return this.calculateFabricTotal(
          {
            ...item,
            selections: normalizedSelections,
          },
          product as ProductDocument,
        );

      case ProductKind.ACCESSORY:
        return this.calculateAccessoryTotal(
          normalizedSelections.accessory_selection as AccessorySelectionDto[],
          product as ProductDocument,
        );

      default:
        return 0;
    }
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

  private async calculateClothingTotal(
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

  private async calculateFabricTotal(
    item: ProcessedOrderItem,
    product: ProductDocument,
  ): Promise<number> {
    const selections = item.selections?.fabric_selection;
    if (selections)
      return this.round(await this.calculateFabricCost(selections, product));
    return 0;
  }

  private async calculateFabricCost(
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

  private async calculateAccessoryTotal(
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
        const variant = accessory.variant;
        if (variant && s.variant_id) {
          if (String(variant._id) !== String(s.variant_id)) {
            throw new BadRequestException(
              `Selected variant not found for accessory "${accessory.name}"`,
            );
          }

          if ((variant.stock ?? 0) < (s.quantity ?? 0)) {
            throw new BadRequestException(
              `Not enough stock for variant "${variant._id}" of accessory "${accessory.name}". Remaining: ${variant.stock}`,
            );
          }

          total +=
            (variant.price ?? accessory.base_price ?? 0) * (s.quantity ?? 1);
          continue; // already processed
        }

        // Check accessory stock
        if ((accessory.stock ?? 0) < (s.quantity ?? 0)) {
          throw new BadRequestException(
            `Not enough stock for accessory "${accessory.name}". Remaining: ${accessory.stock}`,
          );
        }

        total += (accessory.base_price ?? 0) * (s.quantity ?? 1);
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

        const variant = accessory.variant;
        if (variant && s.variant_id) {
          if (String(variant._id) !== String(s.variant_id)) {
            throw new BadRequestException(
              `Selected variant not found for accessory "${accessory.name}" in clothing`,
            );
          }

          if ((variant.stock ?? 0) < (s.quantity ?? 0)) {
            throw new BadRequestException(
              `Not enough stock for variant "${variant._id}" of accessory "${accessory.name}" in clothing. Remaining: ${variant.stock}`,
            );
          }

          total +=
            (variant.price ?? accessory.base_price ?? 0) * (s.quantity ?? 1);
          continue;
        }

        // Check accessory stock
        if ((accessory.stock ?? 0) < (s.quantity ?? 0)) {
          throw new BadRequestException(
            `Not enough stock for accessory "${accessory.name}" in clothing. Remaining: ${accessory.stock}`,
          );
        }

        total += (accessory.base_price ?? 0) * (s.quantity ?? 1);
      }
    }

    return this.round(total);
  }

  private async calculateColorVariantCost(
    selections: VariantSelectionDto[],
    product: ProductDocument,
  ): Promise<number> {
    let total = 0;

    for (const s of selections) {
      const variant = product.clothing?.variants?.find(
        (v) => String(v._id) === String(s.variant_id),
      );

      if (!variant) {
        throw new BadRequestException('Selected variant not found in clothing');
      }

      // Optional: check stock
      if ((variant.stock ?? 0) < (s.quantity ?? 0)) {
        throw new BadRequestException(
          `Not enough stock for variant "${variant._id}" in clothing. Remaining: ${variant.stock}`,
        );
      }

      total += (variant.price ?? 0) * (s.quantity ?? 1);
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
