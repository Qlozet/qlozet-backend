import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schema/cart.schema';
import { Product, ProductDocument } from '../products/schemas';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { OrderItemSelectionsDto } from '../orders/dto/selection.dto';
import { PriceCalculationService } from '../orders/orders.price-calculation';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    private readonly priceCalculationService: PriceCalculationService,
  ) {}

  async getCart(userId: string): Promise<CartDocument> {
    let cart = await this.cartModel
      .findOne({ user: userId })
      .populate('items.product_id');
    if (!cart) {
      cart = await this.cartModel.create({ user: userId, items: [] });
    }
    return cart;
  }

  async addItem(
    userId: string,
    productId: string,
    quantity = 1,
    appliedFabricId?: string,
    appliedFabricYards?: number,
    note?: string,
    selections?: OrderItemSelectionsDto,
  ): Promise<CartDocument> {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    // Component-inclusive per-unit price (base + selected styles/fabric/
    // accessories/addons/variants, with discount) so the cart subtotal matches
    // what the order will actually charge. Falls back to base/discounted price
    // if re-pricing fails (e.g. a stale selection), so add-to-cart never breaks.
    let unitPrice: number;
    const fallbackUnitPrice =
      product.discounted_price != null &&
      product.discounted_price > 0 &&
      product.discounted_price < product.base_price
        ? product.discounted_price
        : product.base_price;
    try {
      const s = selections as any;
      unitPrice = await this.priceCalculationService.calculateItemTotal({
        product_id: productId,
        quantity: 1,
        selections: {
          color_variant_selection: s?.color_variant_selections ?? [],
          style_selection: s?.style_selections ?? [],
          fabric_selection: s?.fabric_selections ?? [],
          accessory_selection: s?.accessory_selections ?? [],
          addon_selection: s?.addon_selections ?? [],
        },
      } as any);
      if (!unitPrice || unitPrice <= 0) unitPrice = fallbackUnitPrice;
    } catch {
      unitPrice = fallbackUnitPrice;
    }

    // If an external fabric is applied, validate and add its cost
    let fabricObjectId: Types.ObjectId | undefined;
    if (appliedFabricId && appliedFabricYards) {
      const fabricProduct = await this.productModel.findById(appliedFabricId);
      if (!fabricProduct || fabricProduct.kind !== 'fabric') {
        throw new NotFoundException('Applied fabric product not found');
      }
      if (!fabricProduct.fabric) {
        throw new NotFoundException('Fabric data is missing from this product');
      }

      // ── Check if this is cross-vendor fabric ──
      const clothingBizId = product.business?.toString();
      const fabricBizId = fabricProduct.business?.toString();

      if (clothingBizId && fabricBizId && clothingBizId !== fabricBizId) {
        // Product-level override takes priority, then vendor-level default
        const productAllows = product.clothing?.accepts_external_fabric;
        let allowed: boolean;

        if (productAllows !== null && productAllows !== undefined) {
          // Product has explicit override
          allowed = productAllows;
        } else {
          // Fall back to vendor-level setting
          const vendorBusiness = await this.businessModel.findById(clothingBizId);
          allowed = vendorBusiness?.accepts_external_fabric ?? true;
        }

        if (!allowed) {
          throw new BadRequestException(
            'This product does not accept external fabric from other vendors. ' +
            'Please choose a fabric from the same vendor or remove the applied fabric.',
          );
        }
      }
      if (appliedFabricYards < fabricProduct.fabric.min_cut) {
        throw new BadRequestException(
          `Minimum yardage is ${fabricProduct.fabric.min_cut} for this fabric`,
        );
      }
      const fabricCost =
        fabricProduct.fabric.price_per_yard * appliedFabricYards;
      unitPrice += fabricCost;
      fabricObjectId = new Types.ObjectId(appliedFabricId);
    }

    const totalPrice = unitPrice * quantity;

    const cart = await this.getCart(userId);
    const existingItem = cart.items.find(
      (i) => (i.product_id as any)?._id?.toString() === productId.toString() || i.product_id.toString() === productId.toString(),
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.total_price =
        existingItem.quantity * existingItem.unit_price;
      // Replace selections when re-adding (customer re-configured)
      if (selections) {
        existingItem.selections = selections as any;
      }
      if (note !== undefined) {
        existingItem.note = note;
      }
    } else {
      cart.items.push({
        product_id: new Types.ObjectId(productId),
        applied_fabric_id: fabricObjectId || undefined,
        applied_fabric_yards: appliedFabricYards || undefined,
        selections: selections as any,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        note,
      });
    }

    this.calculateTotals(cart);
    await cart.save();
    return cart;
  }

  async removeItem(userId: string, productId: string): Promise<CartDocument> {
    const cart = await this.getCart(userId);
    cart.items = cart.items.filter(
      (i) => {
        const itemId = (i.product_id as any)?._id?.toString() || i.product_id.toString();
        return itemId !== productId.toString();
      }
    ) as any;
    this.calculateTotals(cart);
    cart.markModified('items');
    await cart.save();
    return cart;
  }

  private calculateTotals(cart: CartDocument) {
    cart.subtotal = cart.items.reduce((sum, i) => sum + i.total_price, 0);
  }

  async clearCart(userId: string) {
    await this.cartModel.updateOne(
      { user: userId },
      { $set: { items: [], subtotal: 0, total: 0 } },
    );
  }
}
