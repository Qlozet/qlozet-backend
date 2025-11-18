import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas';
import { ProductKind, ClothingType } from './schemas/orders.interfaces';
import { ProcessedOrderItemDto } from './dto/order-item.dto';

@Injectable()
export class OrderValidationService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
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
        color_variant_selections,
        style_selections,
        accessory_selections,
      } = item.selections || {};

      // Validation rules
      if (isCustomize) {
        if (!fabric_selections?.length && !color_variant_selections?.length)
          throw new BadRequestException(
            'Customized clothing must include either fabric or variant selections',
          );
        if (fabric_selections?.length && color_variant_selections?.length)
          throw new BadRequestException(
            'Customized clothing cannot include both fabric and variant selections',
          );
      } else {
        if (!color_variant_selections?.length)
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
      if (
        Array.isArray(color_variant_selections) &&
        color_variant_selections?.length
      ) {
        for (const cv of color_variant_selections) {
          const color = clothing.color_variants?.find(
            (vDoc) => String(vDoc._id) === String(cv.variant_id),
          );
          if (!color)
            throw new BadRequestException(
              `Color variant not found: ${cv.variant_id}`,
            );

          for (const v of color.variants) {
            if (v.size === cv.size) {
              if ((v.stock ?? 0) < (cv.quantity ?? 0))
                throw new BadRequestException(
                  `Not enough stock for variant "${v._id}". Remaining: ${v.stock}`,
                );

              const price = v.price ?? 0;
              totalPrice += price * (cv.quantity ?? 1);

              breakdown.variants.push({
                name: v._id,
                price,
                quantity: cv.quantity ?? 1,
              });
            }
          }
        }
      }

      /** ---------------- FABRIC PRICING ---------------- */
      if (Array.isArray(fabric_selections) && fabric_selections?.length > 0) {
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
      if (Array.isArray(style_selections) && style_selections?.length > 0) {
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
      if (
        Array.isArray(accessory_selections) &&
        accessory_selections?.length > 0
      ) {
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

          let price = accessory.price ?? 0;
          const variants = accessory.variants;
          if (a.variant_id && variants.length > 0) {
            for (const v of variants) {
              if (String(v._id) !== String(a.variant_id))
                throw new BadRequestException(
                  `Selected variant not found for accessory "${accessory.name}"`,
                );
              price += price ?? 0;
            }
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
        (item.selections?.color_variant_selections?.length ?? 0) > 0 ||
        (item.selections?.style_selections?.length ?? 0) > 0 ||
        (item.selections?.accessory_selections?.length ?? 0) > 0
      ) {
        throw new BadRequestException(
          'Fabric product cannot include styles, color variants, or accessories',
        );
      }

      for (const f of fabricSelections) {
        const fabric = product.fabric;
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
        item.selections?.color_variant_selections?.length ||
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

        let price = accessory.price ?? 0;
        const variants = accessory.variants;
        if (a.variant_id && variants.length > 0) {
          for (const v of variants) {
            if (String(v._id) !== String(a.variant_id))
              throw new BadRequestException(
                `Selected variant not found for accessory "${accessory.name}"`,
              );
            price += price ?? 0;
          }
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
