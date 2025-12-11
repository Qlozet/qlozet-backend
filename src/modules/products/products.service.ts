// product.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  Accessory,
  AccessoryDocument,
  Fabric,
  FabricDocument,
  Product,
  ProductDocument,
} from './schemas';
import { CreateProductDto } from './dto';
import { Utils } from '../../common/utils/pagination';
import { ClothingType } from './dto/clothing.dto';

import { UserDocument } from '../ums/schemas';
import { Cron } from '@nestjs/schedule';
import {
  Order,
  OrderDocument,
  OrderItem,
} from '../orders/schemas/orders.schema';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Product.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Accessory.name)
    private readonly accessoryModel: Model<AccessoryDocument>,
    @InjectModel(Fabric.name)
    private readonly fabricModel: Model<FabricDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Create a product and compute its price dynamically based on type
   */
  async upsert(
    dto: CreateProductDto,
    business: Types.ObjectId,
    kind: string,
  ): Promise<{ data: ProductDocument; message: string }> {
    // 1. Compute price based on kind
    let totalPrice = 0;
    if (kind === 'clothing') {
      totalPrice = this.computeClothingPrice(dto);
    } else if (kind === 'accessory') {
      totalPrice = this.computeAccessoryPrice(dto);
    } else if (kind === 'fabric') {
      totalPrice = this.computeFabricPrice(dto);
    }
    if (dto.product_id) {
      const existing = await this.productModel.findById(dto.product_id);

      if (existing) {
        if (existing.business.toString() !== business.toString()) {
          throw new ForbiddenException(
            'You do not have permission to update this product',
          );
        }

        const { product_id, ...safeData } = dto;

        Object.assign(existing, {
          ...safeData,
          base_price: totalPrice,
          kind,
        });

        await existing.save();

        return {
          data: existing.toJSON(),
          message: 'Product updated successfully',
        };
      }
    }

    // 3. Otherwise create new product
    const created = await this.productModel.create({
      ...dto,
      business,
      kind,
      base_price: totalPrice,
    });

    return {
      data: created.toJSON(),
      message: 'Product created successfully',
    };
  }

  /**
   * Get all products
   */
  async findAll(
    page: number = 1,
    size: number = 10,
    kind?: string,
    search?: string,
    status?: 'active' | 'draft' | 'archived',
    sortBy?: 'rating' | 'date' | 'relevance',
    order: 'asc' | 'desc' = 'desc',
  ) {
    const filter: any = {};

    if (kind) filter.kind = kind;
    const validStatuses = ['active', 'draft', 'archived'];
    if (status && validStatuses.includes(status.toLowerCase())) {
      filter.status = status.toLowerCase();
    }
    if (search) {
      filter.$or = [
        { 'clothing.name': { $regex: search, $options: 'i' } },
        { 'accessory.name': { $regex: search, $options: 'i' } },
        { 'fabric.name': { $regex: search, $options: 'i' } },

        { 'clothing.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'accessory.taxonomy.categories': { $regex: search, $options: 'i' } },
        { 'fabric.taxonomy.categories': { $regex: search, $options: 'i' } },

        { 'clothing.taxonomy.attributes': { $regex: search, $options: 'i' } },
        { 'accessory.taxonomy.attributes': { $regex: search, $options: 'i' } },
        { 'fabric.taxonomy.attributes': { $regex: search, $options: 'i' } },
      ];
    }

    const { take, skip } = await Utils.getPagination(page, size);

    // Determine sort order
    const sortOrder = order === 'asc' ? 1 : -1;
    let sort: Record<string, 1 | -1> = {};

    switch (sortBy) {
      case 'rating':
        sort = { average_rating: sortOrder }; // ascending or descending rating
        break;
      case 'date':
        sort = { createdAt: sortOrder }; // ascending or descending date
        break;
      case 'relevance':
        sort = search
          ? { average_rating: -1, createdAt: -1 }
          : { createdAt: -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    const [rows, count] = await Promise.all([
      this.productModel.find(filter).sort(sort).skip(skip).limit(take).exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }
  // trending this week, top vendors, new vendors
  /**
   * Get a product by ID
   */
  async findById(id: string): Promise<ProductDocument> {
    const product = await this.productModel.findById(id).exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /**
   * Delete a product
   */
  async delete(id: string, vendor: string): Promise<void> {
    const deleted = await this.productModel.findOneAndDelete({
      _id: new Types.ObjectId(id),
    });

    if (!deleted) {
      throw new NotFoundException(
        'Product not found or you do not have permission to delete this product',
      );
    }
  }

  // 💰 Helper methods

  private computeClothingPrice(dto: any): number {
    const clothing = dto?.clothing;
    if (!clothing) return 0;

    const isCustomize = clothing?.type === ClothingType.CUSTOMIZE;
    let total = 0;
    // --- CUSTOMIZE ---
    if (isCustomize) {
      const hasFabric =
        Array.isArray(clothing.fabrics) && clothing.fabrics.length > 0;
      const hasColorVariants =
        Array.isArray(clothing.color_variants) &&
        clothing.color_variants.length > 0;
      const hasStyles =
        Array.isArray(clothing.styles) && clothing.styles.length > 0;
      const hasAccessories =
        Array.isArray(clothing.accessories) && clothing.accessories.length > 0;

      // ✅ Validate rules
      if (!hasStyles)
        throw new Error('Styles are required for customized clothing.');
      if (hasFabric && hasColorVariants)
        throw new Error(
          'Customized clothing cannot have both fabric and color variants.',
        );

      // 🎨 Styles (required)
      total += clothing.styles.reduce((sum, s) => sum + (s.price || 0), 0);

      // 🧵 Fabric (optional)
      if (hasFabric) {
        total += clothing.fabrics.reduce((sum, fabric) => {
          const fabricBase =
            (fabric.price_per_yard || 0) * (fabric.yard_length || 0);
          const variantTotal = Array.isArray(fabric.variants)
            ? fabric.variants.reduce(
                (vSum, v) => vSum + (v.price || 0) * (v.stock || 0),
                0,
              )
            : 0;
          return sum + fabricBase + variantTotal;
        }, 0);
      }

      // 🎨 Color Variants (optional, exclusive with fabric)
      else if (hasColorVariants) {
        total += clothing.color_variants.reduce((sum, color) => {
          const colorSum = Array.isArray(color.variants)
            ? color.variants.reduce(
                (vSum, v) => vSum + (v.price || 0) * (v.stock || 0),
                0,
              )
            : 0;
          return sum + colorSum;
        }, 0);
      }

      // 🧷 Accessories (optional)
      if (hasAccessories) {
        total += clothing.accessories.reduce((sum, accessory) => {
          const basePrice = accessory.price || 0;
          const variantStock =
            accessory.variants?.reduce((vSum, v) => vSum + (v.stock || 0), 0) ||
            0;
          const accessoryTotal = variantStock
            ? variantStock * basePrice
            : basePrice;
          console.log(accessoryTotal, 'accessoryTotal');
          return sum + accessoryTotal;
        }, 0);
      }

      return total;
    }

    // --- NON-CUSTOMIZE ---
    const hasFabric =
      Array.isArray(clothing.fabrics) && clothing.fabrics.length > 0;
    const hasStyles =
      Array.isArray(clothing.styles) && clothing.styles.length > 0;
    const hasAccessories =
      Array.isArray(clothing.accessories) && clothing.accessories.length > 0;

    if (hasFabric || hasStyles || hasAccessories)
      throw new BadRequestException(
        'Fabric, styles, and accessories are not allowed for non-customized clothing.',
      );

    if (Array.isArray(clothing.color_variants)) {
      total += clothing.color_variants.reduce((sum, color) => {
        const colorSum = Array.isArray(color.variants)
          ? color.variants.reduce(
              (vSum, v) => vSum + (v.price || 0) * (v.stock || 0),
              0,
            )
          : 0;
        return sum + colorSum;
      }, 0);
    }

    return total;
  }

  private computeAccessoryPrice(dto: any): number {
    const accessory = dto?.accessory;
    if (!accessory) return 0;

    const basePrice = accessory.price || 0;
    const variantStock =
      Array.isArray(accessory.variants) && accessory.variants.length > 0
        ? accessory.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
        : 0;
    const total = variantStock > 0 ? basePrice * variantStock : basePrice;

    return total;
  }

  private computeFabricPrice(dto: any): number {
    const fabric = dto?.fabric;
    if (!fabric.price_per_yard || !fabric.yard_length) {
      throw new BadRequestException(
        'Fabric must have both yard_length and price_per_yard',
      );
    }
    const effectiveLength = Math.max(fabric.yard_length, fabric.min_cut || 0);
    const total = fabric.price_per_yard * effectiveLength;

    return total;
  }

  async findByVendor(
    vendor: string,
    kind: string,
    page: number = 1,
    size: number = 10,
  ) {
    const filter: any = {};
    if (kind) {
      filter.kind = kind;
    }
    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.productModel
        .find({ ...filter, vendor })
        .skip(skip)
        .limit(take)
        .exec(),
      this.productModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }
  async getLatestProducts(page: number = 1, size: number = 10) {
    const { take, skip } = await Utils.getPagination(page, size);
    const [rows, count] = await Promise.all([
      this.productModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .populate('business', 'business_name business_logo_url')
        .select('kind base_price average_rating business')
        .exec(),
      this.productModel.countDocuments(),
    ]);

    const products = rows.map((p) => ({
      id: p._id,
      kind: p.kind,
      base_price: p.base_price,
      average_rating: p.average_rating,
      business: p.business,
    }));
    return Utils.getPagingData({ count, rows: products }, page, size);
  }
  async rateProduct(
    productId: string,
    userId: string,
    value: number,
    comment?: string,
  ): Promise<ProductDocument> {
    if (value < 1 || value > 5) {
      throw new BadRequestException('Rating value must be between 1 and 5');
    }

    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existingRating = product.ratings.find((r) =>
      r.user.equals(new Types.ObjectId(userId)),
    );

    if (existingRating) {
      existingRating.value = value;
      existingRating.comment = comment;
    } else {
      product.ratings.push({
        user: new Types.ObjectId(userId),
        value,
        comment,
      });
    }

    // Recalculate average rating
    const totalRatings = product.ratings.length;
    const totalValue = product.ratings.reduce((sum, r) => sum + r.value, 0);
    product.average_rating = parseFloat((totalValue / totalRatings).toFixed(1));

    await product.save();

    return product;
  }
  async getProductRating(productId: string) {
    const product = await this.productModel
      .findById(productId)
      .select('average_rating ratings')
      .populate('ratings.user', 'name email');

    if (!product) throw new NotFoundException('Product not found');

    return {
      average: product.average_rating,
      total_reviews: product.ratings.length,
      ratings: product.ratings,
    };
  }
  async toggleWishlist(userId: string, productId: string) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.wishlist) user.wishlist = [];

    const index = user.wishlist.findIndex((p) => p.toString() === productId);

    if (index === -1) {
      user.wishlist.push(new Types.ObjectId(productId));
      await user.save();
      return { message: 'Product added to wishlist', data: user.wishlist };
    } else {
      user.wishlist.splice(index, 1);
      await user.save();
      return {
        message: 'Product removed from wishlist',
        data: user.wishlist,
      };
    }
  }
  async getTrendingProductsThisWeek() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return await this.productModel
      .find({
        createdAt: { $gte: sevenDaysAgo }, // Active this week
      })
      .sort({
        average_rating: -1, // Highly rated first
        'ratings.length': -1, // More engagement
        createdAt: -1, // New → trending
      })
      .limit(20)
      .populate('business', 'business_name business_logo_url')
      .exec();
  }
  async updateStatus(
    productId: string,
    business: string,
    status: 'active' | 'draft' | 'archived',
  ) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    if (product.business.toString() !== business.toString()) {
      throw new ForbiddenException(
        'You do not have permission to update this product',
      );
    }
    product.status = status;

    // If manually updated, clear scheduled activation
    product.scheduled_activation_date = undefined;

    await product.save();

    return {
      message: `Product status updated to ${status}`,
      data: product,
    };
  }

  async scheduleActivation(
    productId: string,
    businessId: string,
    activationDate: Date,
  ) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    if (new Date(activationDate) <= new Date()) {
      throw new BadRequestException('Activation date must be in the future');
    }
    if (product.business.toString() != businessId) {
      throw new ForbiddenException(
        'You are not allowed to modify this product',
      );
    }
    product.scheduled_activation_date = activationDate;
    await product.save();

    return {
      message: 'Product scheduled for automatic activation',
      data: product,
    };
  }
  // Runs every 1 minute
  @Cron('*/1 * * * *')
  async activateScheduledProducts() {
    const now = new Date();
    this.logger.log(
      `Running scheduled activation check at ${now.toISOString()}`,
    );

    const result = await this.productModel.updateMany(
      {
        scheduled_activation_date: { $lte: now },
        status: { $ne: 'active' },
      },
      {
        $set: { status: 'active', scheduled_activation_date: null },
      },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Activated ${result.modifiedCount} product(s) scheduled for activation.`,
      );
    } else {
      this.logger.log('No products to activate at this time.');
    }
  }

  async updateInventory(orderId: Types.ObjectId) {
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel.findById(orderId).session(session);

        if (!order?.items || order.items.length === 0) return;

        for (const item of order.items) {
          await this.updateFabric(item, session);
          await this.updateAccessory(item, session);
        }
      });
    } catch (err) {
      this.logger.error('updateInventory failed', err.stack || err.message);
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async updateFabric(item: OrderItem, session, quantityMultiplier = 1) {
    let fabric;
    let isEmbedded = false;
    const fabricSelection = item.fabric_selections;
    if (Array.isArray(fabricSelection) && fabricSelection.length > 0) {
      for (let selection of fabricSelection) {
        fabric = await this.fabricModel.findById(selection.fabric_id);
        if (!fabric) {
          const product = await this.productModel.findById(item.product);
          if (!product) throw new BadRequestException('Product not found');

          fabric = product.clothing?.fabrics?.find(
            (f) => String(f._id) === String(selection.fabric_id),
          ) as FabricDocument | undefined;

          if (!fabric) {
            throw new BadRequestException(
              `Fabric ${selection.fabric_id} not found in product or standalone`,
            );
          }
          isEmbedded = true;
        }
        const totalYards =
          (selection.yardage ?? 0) *
          (selection.quantity ?? 1) *
          quantityMultiplier;
        if (fabric.yard_length < totalYards) {
          throw new BadRequestException(
            `Not enough fabric (${fabric.name}) available`,
          );
        }
        fabric.yard_length -= totalYards;
        if (isEmbedded) {
          await this.productModel
            .updateOne(
              {
                _id: item.product,
                'clothing.fabrics._id': fabric._id,
              },
              {
                $set: {
                  'clothing.fabrics.$.yard_length': fabric.yard_length,
                },
              },
            )
            .session(session);
          return;
        }
        await fabric.save({ session });
      }
    }
  }
  async updateAccessory(
    item: OrderItem,
    session?: any,
    quantityMultiplier = 1,
  ) {
    const accessorySelections = item.accessory_selections || [];

    for (const selection of accessorySelections) {
      let accessoryVariant: any;
      let isEmbedded = false;

      if (this.accessoryModel) {
        const accessory = await this.accessoryModel
          .findById(selection.accessory_id)
          .session(session);
        if (accessory) {
          accessoryVariant = accessory.variants.find(
            (v: any) => String(v._id) === String(selection.variant_id),
          );
        }
      }
      if (!accessoryVariant) {
        const product = await this.productModel
          .findById(item.product)
          .session(session);
        if (!product) throw new BadRequestException('Product not found');

        const embeddedAccessory = product.clothing?.accessories?.find(
          (a) => String(a._id) === String(selection.accessory_id),
        );
        if (embeddedAccessory) {
          accessoryVariant = embeddedAccessory.variants.find(
            (v) => String(v._id) === String(selection.variant_id),
          );
          isEmbedded = true;
        }
      }

      if (!accessoryVariant) {
        throw new BadRequestException(
          `Accessory variant ${selection.variant_id} not found in standalone or embedded accessory`,
        );
      }

      // 3️⃣ Calculate total quantity needed
      const totalQuantity = (selection.quantity ?? 1) * quantityMultiplier;
      if ((accessoryVariant.stock ?? 0) < totalQuantity) {
        throw new BadRequestException(
          `Not enough stock for accessory variant (${accessoryVariant._id})`,
        );
      }

      // 4️⃣ Decrement stock
      accessoryVariant.stock -= totalQuantity;

      // 5️⃣ Save changes
      if (isEmbedded) {
        await this.productModel
          .updateOne(
            {
              _id: item.product,
              'clothing.accessories._id': accessoryVariant._id,
            },
            {
              $set: {
                'clothing.accessories.$.variants.$[v].stock':
                  accessoryVariant.stock,
              },
            },
            { arrayFilters: [{ 'v._id': accessoryVariant._id }] },
          )
          .session(session);
      } else {
        await accessoryVariant.save?.({ session });
      }
    }
  }
  // async updateStyles(item: OrderItem, session?: any, quantityMultiplier = 1) {
  //   const styleSelections = item.style_selections || [];
  //   if (styleSelections.length === 0) return;
  //   const product = await this.productModel
  //     .findById(item.product)
  //     .session(session);
  //   if (!product || !product.clothing)
  //     throw new BadRequestException('Product or clothing not found');

  //   const clothing = product.clothing;
  //   if (clothing.type !== 'customize') return;
  //   for (const selection of styleSelections) {
  //     if (Array.isArray(clothing?.styles) && clothing?.styles.length > 0) {
  //       const style = clothing?.styles.find(
  //         (s) => String(s._id) === String(selection.style_id),
  //       );
  //       if (!style)
  //         throw new BadRequestException(
  //           `Style ${selection.style_id} not found`,
  //         );

  //       await this.productModel
  //         .updateOne(
  //           {
  //             _id: item.product,
  //             'clothing.styles._id': style._id,
  //           },
  //           {
  //             $set: {
  //               'clothing.accessories.$.variants.$[v].stock':
  //                 accessoryVariant.stock,
  //             },
  //           },
  //           { arrayFilters: [{ 'v._id': accessoryVariant._id }] },
  //         )
  //         .session(session);
  //     }
  //   }
  // }
}
