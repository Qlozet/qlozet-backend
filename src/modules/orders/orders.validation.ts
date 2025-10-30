import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FlattenMaps, Model, Types } from 'mongoose';
import {
  Product,
  ProductDocument,
  Fabric,
  FabricDocument,
  Variant,
  VariantDocument,
  Style,
  StyleDocument,
  Accessory,
  AccessoryDocument,
} from '../products/schemas';
import {
  ProductKind,
  FabricSelection,
  AccessorySelection,
  ClothingType,
} from './schemas/orders.interfaces';
import { ProcessedOrderItemDto } from './dto/order-item.dto';
import { StyleSelectionDto } from './dto/selection.dto';

@Injectable()
export class OrderValidationService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Fabric.name)
    private readonly fabricModel: Model<FabricDocument>,
    @InjectModel(Variant.name)
    private readonly variantModel: Model<VariantDocument>,
    @InjectModel(Style.name) private readonly styleModel: Model<StyleDocument>,
    @InjectModel(Accessory.name)
    private readonly accessoryModel: Model<AccessoryDocument>,
  ) {}

  /** Entry point for a single order item */
  async validateOrderItem(
    item: Partial<ProcessedOrderItemDto>,
  ): Promise<{ total_price: number; breakdown: any }> {
    if (!item.product_id)
      throw new BadRequestException('Product ID is required');

    // Fetch product once
    const product = await this.productModel.findById(item.product_id).lean();
    if (!product) throw new BadRequestException('Product not found');

    let totalPrice = 0;
    const breakdown: any = {
      product: product.kind,
      fabrics: [],
      variants: [],
      accessories: [],
      styles: [],
    };

    /** ---------------- CLOTHING ---------------- */
    if (product.kind === ProductKind.CLOTHING) {
      const clothing = product.clothing;
      if (!clothing)
        throw new BadRequestException('Clothing product details missing');

      const isCustomize = clothing.type === ClothingType.CUSTOMIZE;
      const {
        fabric_selections,
        variant_selections,
        style_selections,
        accessory_selections,
      } = item.selections || {};

      // Validation rules
      if (isCustomize) {
        if (!fabric_selections?.length && !variant_selections?.length)
          throw new BadRequestException(
            'Customized clothing must include either fabric or variant selections',
          );
        if (fabric_selections?.length && variant_selections?.length)
          throw new BadRequestException(
            'Customized clothing cannot include both fabric and variant selections',
          );
      } else {
        if (!variant_selections?.length)
          throw new BadRequestException(
            'Non-customized clothing must include variant selections',
          );
        if (
          fabric_selections?.length ||
          accessory_selections?.length ||
          style_selections?.length
        )
          throw new BadRequestException(
            'Non-customized clothing cannot include fabrics, styles, or accessories',
          );
      }

      /** ---------------- VARIANT PRICING ---------------- */
      if (variant_selections?.length) {
        for (const v of variant_selections) {
          const variant = clothing.variants?.find(
            (vDoc) => String(vDoc._id) === String(v.variant_id),
          );
          if (!variant)
            throw new BadRequestException(`Variant not found: ${v.variant_id}`);

          if ((variant.stock ?? 0) < (v.quantity ?? 0))
            throw new BadRequestException(
              `Not enough stock for variant "${variant._id}". Remaining: ${variant.stock}`,
            );

          const price = variant.price ?? 0;
          totalPrice += price * (v.quantity ?? 1);

          breakdown.variants.push({
            name: variant._id,
            price,
            quantity: v.quantity ?? 1,
          });
        }
      }

      /** ---------------- FABRIC PRICING ---------------- */
      if (fabric_selections?.length) {
        for (const f of fabric_selections) {
          const fabric = clothing.fabrics?.find(
            (fab) => String(fab._id) === String(f.fabric_id),
          );
          if (!fabric)
            throw new BadRequestException(`Fabric not found: ${f.fabric_id}`);

          if ((fabric.yard_length ?? 0) < (f.yardage ?? 0))
            throw new BadRequestException(
              `Insufficient fabric stock for "${fabric.name}". Remaining: ${fabric.yard_length}`,
            );

          const price = (fabric.price_per_yard ?? 0) * (f.yardage ?? 0);
          totalPrice += price * (f.quantity ?? 1);

          breakdown.fabrics.push({
            name: fabric.name,
            yardage: f.yardage,
            price,
          });
        }
      }

      /** ---------------- STYLE PRICING ---------------- */
      if (style_selections?.length) {
        for (const s of style_selections) {
          const style = clothing.styles?.find(
            (st) => String(st._id) === String(s.style_id),
          );
          if (!style)
            throw new BadRequestException(`Style not found: ${s.style_id}`);

          const price = style.price ?? 0;
          totalPrice += price;

          breakdown.styles.push({
            name: style.name,
            price,
          });
        }
      }

      /** ---------------- ACCESSORY PRICING ---------------- */
      if (accessory_selections?.length) {
        for (const a of accessory_selections) {
          const accessory = clothing.accessories?.find(
            (acc) => String(acc._id) === String(a.accessory_id),
          );
          if (!accessory)
            throw new BadRequestException(
              `Accessory not found: ${a.accessory_id}`,
            );

          if ((accessory.stock ?? 0) < (a.quantity ?? 0))
            throw new BadRequestException(
              `Not enough stock for accessory "${accessory.name}". Remaining: ${accessory.stock}`,
            );

          let price = accessory.base_price ?? 0;
          if (a.variant_id && accessory.variant) {
            if (String(accessory.variant._id) !== String(a.variant_id))
              throw new BadRequestException(
                `Selected variant not found for accessory "${accessory.name}"`,
              );
            price += accessory.variant.price ?? 0;
          }

          totalPrice += price * (a.quantity ?? 1);

          breakdown.accessories.push({
            name: accessory.name,
            price,
            quantity: a.quantity,
          });
        }
      }
    } else if (product.kind === ProductKind.FABRIC) {
      /** ---------------- FABRIC PRODUCT ---------------- */
      const fabricSelections = item.selections?.fabric_selections;
      if (!fabricSelections?.length)
        throw new BadRequestException(
          'Fabric product must include fabric selections',
        );

      if (
        item.selections?.variant_selections?.length ||
        item.selections?.style_selections?.length ||
        item.selections?.accessory_selections?.length
      )
        throw new BadRequestException(
          'Fabric product cannot include styles, variants, or accessories',
        );

      for (const f of fabricSelections) {
        const fabric = product.fabric;
        console.log(f.fabric_id, 'f.fabric_id');
        if (!fabric)
          throw new BadRequestException(`Fabric not found: ${f.fabric_id}`);

        const price = (fabric.price_per_yard ?? 0) * (f.yardage ?? 0);
        totalPrice += price;

        breakdown.fabrics.push({
          name: fabric.name,
          yardage: f.yardage,
          price,
        });
      }
    } else if (product.kind === ProductKind.ACCESSORY) {
      /** ---------------- ACCESSORY PRODUCT ---------------- */
      const accessorySelections = item.selections?.accessory_selections;
      if (!accessorySelections?.length)
        throw new BadRequestException(
          'Accessory product must include accessory selections',
        );

      if (
        item.selections?.variant_selections?.length ||
        item.selections?.style_selections?.length ||
        item.selections?.fabric_selections?.length
      )
        throw new BadRequestException(
          'Accessory product cannot include styles, variants, or fabrics',
        );

      for (const a of accessorySelections) {
        const accessory = product.accessory;
        if (!accessory)
          throw new BadRequestException(
            `Accessory not found: ${a.accessory_id}`,
          );

        let price = accessory.base_price ?? 0;
        if (a.variant_id && accessory.variant) {
          if (String(accessory.variant._id) !== String(a.variant_id))
            throw new BadRequestException(
              `Selected variant not found for accessory "${accessory.name}"`,
            );
          price += accessory.variant.price ?? 0;
        }

        totalPrice += price * (a.quantity ?? 1);

        breakdown.accessories.push({
          name: accessory.name,
          price,
          quantity: a.quantity,
        });
      }
    } else {
      /** ---------------- UNSUPPORTED ---------------- */
      throw new BadRequestException(
        `Unsupported product kind: ${product.kind}`,
      );
    }

    return { total_price: totalPrice, breakdown };
  }

  /** ---------------- VARIANT VALIDATION ---------------- */
  private async validateColorVariant(
    colorVariantId: Types.ObjectId,
    quantity: number,
    size?: string,
  ): Promise<void> {
    if (quantity <= 0)
      throw new BadRequestException('Quantity must be greater than 0');

    const variant = await this.variantModel.findById(colorVariantId);
    if (!variant)
      throw new BadRequestException('Selected color variant not found');

    if (variant.stock != null && variant.stock < quantity)
      throw new BadRequestException(
        `Insufficient stock for selected color variant. Available: ${variant.stock}, Requested: ${quantity}`,
      );

    if (size && variant.size && variant.size !== size)
      throw new BadRequestException(
        `Size '${size}' is not available for this variant (available: ${variant.size})`,
      );

    if (!variant.colors?.length)
      throw new BadRequestException(
        'Selected variant has no color information',
      );
  }

  /** ---------------- FABRIC VALIDATION ---------------- */
  private async validateFabricSelection(
    fabric: FabricSelection,
    productId?: Types.ObjectId,
  ): Promise<void> {
    if (!fabric.yardage || fabric.yardage <= 0) {
      throw new BadRequestException('Valid yardage is required');
    }

    // 1️⃣ Try to find fabric as standalone
    let fabricDoc: any = await this.fabricModel
      .findById(fabric.fabric_id)
      .lean();

    // 2️⃣ If not found, check within product.clothing.fabrics
    if (!fabricDoc && productId) {
      const product = await this.productModel.findById(productId).lean();
      const clothingFabrics = product?.clothing?.fabrics || [];

      fabricDoc = clothingFabrics.find(
        (f: any) => f._id?.toString() === fabric.fabric_id,
      );
    }

    // 3️⃣ Still not found — invalid
    if (!fabricDoc) {
      throw new BadRequestException(
        `Selected fabric not found: ${fabric.fabric_id}`,
      );
    }

    // 4️⃣ Validate stock and min cut
    if (fabric.yardage < fabricDoc.min_cut) {
      throw new BadRequestException(
        `Minimum yardage for fabric "${fabricDoc.name}" is ${fabricDoc.min_cut}`,
      );
    }

    if (
      fabricDoc.yard_length != null &&
      fabric.yardage > fabricDoc.yard_length
    ) {
      throw new BadRequestException(
        `Insufficient fabric stock. Available: ${fabricDoc.yard_length} yards, Requested: ${fabric.yardage}`,
      );
    }
  }

  /** ---------------- STYLE VALIDATION ---------------- */
  private async validateStyleSelection(
    styleSelection: StyleSelectionDto,
    used: Set<string> = new Set(),
  ): Promise<void> {
    const id = styleSelection.style_id.toString();
    if (used.has(id))
      throw new BadRequestException(`Style "${id}" selected more than once`);
    used.add(id);

    const style = await this.styleModel.findById(styleSelection.style_id);
    if (!style) throw new BadRequestException('Selected style not found');
  }

  /** ---------------- ACCESSORY VALIDATION ---------------- */
  private async validateAccessorySelection(
    a: AccessorySelection,
  ): Promise<void> {
    if (!a.accessory_id)
      throw new BadRequestException('Accessory ID is required');
    if (a.quantity <= 0)
      throw new BadRequestException('Quantity must be greater than 0');

    const accessory = await this.accessoryModel.findById(a.accessory_id);
    if (!accessory) throw new BadRequestException('Accessory not found');

    if (a.variant_id) {
      const variant = accessory.variant;
      if (!variant)
        throw new BadRequestException('Accessory variant not found');
      if (variant.stock < a.quantity)
        throw new BadRequestException(
          `Insufficient stock for accessory variant. Available: ${variant.stock}, Requested: ${a.quantity}`,
        );
    } else if (accessory.stock < a.quantity) {
      throw new BadRequestException(
        `Insufficient stock for accessory "${accessory.name}". Available: ${accessory.stock}, Requested: ${a.quantity}`,
      );
    }
  }

  /** ---------------- FULL ORDER VALIDATION ---------------- */
  async validateCompleteOrder(
    items: ProcessedOrderItemDto[],
  ): Promise<{ total_order_price: number; item_breakdowns: any[] }> {
    if (!items?.length)
      throw new BadRequestException('Order must contain at least one item');

    let total_order_price = 0;
    const item_breakdowns: any = [];

    for (const item of items) {
      const result = await this.validateOrderItem(item);
      total_order_price += result.total_price;
      item_breakdowns.push(result.breakdown);
    }

    return { total_order_price, item_breakdowns };
  }
}
