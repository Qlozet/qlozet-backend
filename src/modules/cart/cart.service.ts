import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schema/cart.schema';
import { Product, ProductDocument } from '../products/schemas';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
import { OrderItemSelectionsDto } from '../orders/dto/selection.dto';
import { PriceCalculationService } from '../orders/orders.price-calculation';
import { isCustomerVisible } from '../products/customer-visibility';

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

  /** A line's identity: the shop's key, or the product id for legacy lines. */
  private keyOf(item: { line_key?: string | null; product_id: any }): string {
    if (item.line_key) return item.line_key;
    const pid = item.product_id?._id ?? item.product_id;
    return String(pid);
  }

  private findLine(cart: CartDocument, lineId: string) {
    const line = cart.items.find((i: any) => String(i._id) === String(lineId));
    if (!line) {
      throw new NotFoundException(
        'That item is no longer in your cart. Refresh to see the current cart.',
      );
    }
    return line;
  }

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
    // Trailing so existing positional callers are unaffected.
    appliedFabricSize?: string,
    line?: {
      lineKey?: string;
      size?: string;
      color?: string;
      measurementSet?: string;
    },
  ): Promise<CartDocument> {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');
    if (!isCustomerVisible(product)) {
      throw new BadRequestException('This item is not available to buy right now.');
    }

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
    // Same key = same line (more of it); a different size, colour, selection
    // or measurement profile is its own line. Without a key, the product id is
    // the key, which is what older clients send.
    const key = line?.lineKey || String(productId);
    const existingItem = cart.items.find((i) => this.keyOf(i) === key);

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.total_price =
        existingItem.quantity * existingItem.unit_price;
      // A keyless (legacy) add replaces selections, as it always did; a keyed
      // add matched on its selections, so there is nothing to replace.
      if (selections && !line?.lineKey) {
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
        applied_fabric_size: appliedFabricSize || undefined,
        selections: selections as any,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        note,
        line_key: line?.lineKey || null,
        size: line?.size || null,
        color: line?.color || null,
        measurement_set: line?.measurementSet || null,
      });
    }

    this.calculateTotals(cart);
    cart.markModified('items');
    await cart.save();
    return this.getCart(userId);
  }

  /** Set one line's quantity. Lines are addressed by their own id. */
  async updateLine(
    userId: string,
    lineId: string,
    quantity: number,
  ): Promise<CartDocument> {
    const cart = await this.getCart(userId);
    const line = this.findLine(cart, lineId);
    line.quantity = quantity;
    line.total_price = quantity * line.unit_price;
    this.calculateTotals(cart);
    cart.markModified('items');
    await cart.save();
    return this.getCart(userId);
  }

  /**
   * Remove one line. Removing a line that is already gone succeeds: the cart
   * the caller wanted is the cart they get, and a retried request must not
   * report an error.
   */
  async removeLine(userId: string, lineId: string): Promise<CartDocument> {
    const cart = await this.getCart(userId);
    const before = cart.items.length;
    cart.items = cart.items.filter(
      (i: any) => String(i._id) !== String(lineId),
    ) as any;
    if (cart.items.length !== before) {
      this.calculateTotals(cart);
      cart.markModified('items');
      await cart.save();
    }
    return this.getCart(userId);
  }

  /**
   * Move a guest cart into the account, once, at sign-in. A line the account
   * already has (same key) is left as it is rather than added to, so a merge
   * that runs twice cannot double anything. Items that cannot be added (a
   * product since deleted) are skipped, and reported back.
   */
  async mergeGuestCart(
    userId: string,
    items: Array<{
      productId: string;
      quantity?: number;
      appliedFabricId?: string;
      appliedFabricYards?: number;
      appliedFabricSize?: string;
      note?: string;
      selections?: OrderItemSelectionsDto;
      lineKey?: string;
      size?: string;
      color?: string;
      measurementSet?: string;
    }>,
  ): Promise<{ cart: CartDocument; skipped: string[] }> {
    const skipped: string[] = [];
    for (const item of items) {
      const cart = await this.getCart(userId);
      const key = item.lineKey || String(item.productId);
      if (cart.items.some((i) => this.keyOf(i) === key)) continue;
      try {
        await this.addItem(
          userId,
          item.productId,
          Math.max(1, item.quantity ?? 1),
          item.appliedFabricId,
          item.appliedFabricYards,
          item.note,
          item.selections,
          item.appliedFabricSize,
          {
            lineKey: item.lineKey,
            size: item.size,
            color: item.color,
            measurementSet: item.measurementSet,
          },
        );
      } catch {
        skipped.push(item.productId);
      }
    }
    return { cart: await this.getCart(userId), skipped };
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
    return this.getCart(userId);
  }

  private calculateTotals(cart: CartDocument) {
    cart.subtotal = cart.items.reduce((sum, i) => sum + i.total_price, 0);
  }

  async clearCart(userId: string) {
    await this.cartModel.updateOne(
      { user: userId },
      { $set: { items: [], subtotal: 0, total: 0 } },
    );
    return this.getCart(userId);
  }
}
