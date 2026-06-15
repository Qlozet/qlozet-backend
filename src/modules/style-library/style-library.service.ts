import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlatformStyle,
  PlatformStyleDocument,
} from './schemas/platform-style.schema';
import {
  CreatePlatformStyleDto,
  UpdatePlatformStyleDto,
  QueryPlatformStyleDto,
} from './dto/platform-style.dto';
import * as seedData from './data/seed-styles.json';
import { Product, ProductDocument } from '../products/schemas/product.schema';

@Injectable()
export class StyleLibraryService {
  private readonly logger = new Logger(StyleLibraryService.name);

  constructor(
    @InjectModel(PlatformStyle.name)
    private readonly styleModel: Model<PlatformStyleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(dto: CreatePlatformStyleDto): Promise<PlatformStyleDocument> {
    const existing = await this.styleModel.findOne({
      style_code: dto.style_code,
    });
    if (existing) {
      throw new ConflictException(
        `Style with code "${dto.style_code}" already exists`,
      );
    }
    return this.styleModel.create(dto);
  }

  async findAll(query: QueryPlatformStyleDto) {
    const filter: any = { is_active: true };

    if (query.category) filter.category = query.category;
    if (query.type) filter.type = query.type;
    if (query.gender) {
      filter.$or = [{ gender: query.gender }, { gender: 'unisex' }];
    }
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { aliases: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }

    const styles = await this.styleModel
      .find(filter)
      .sort({ category: 1, name: 1 })
      .lean();

    // Group by category for easier browsing
    const grouped = styles.reduce((acc, style) => {
      if (!acc[style.category]) acc[style.category] = [];
      acc[style.category].push(style);
      return acc;
    }, {} as Record<string, any[]>);

    return { styles, grouped, total: styles.length };
  }

  async findById(id: string): Promise<PlatformStyleDocument> {
    const style = await this.styleModel.findById(id);
    if (!style) throw new NotFoundException('Platform style not found');
    return style;
  }

  async findByIds(ids: string[]): Promise<PlatformStyleDocument[]> {
    return this.styleModel.find({ _id: { $in: ids }, is_active: true });
  }

  async update(
    id: string,
    dto: UpdatePlatformStyleDto,
  ): Promise<PlatformStyleDocument> {
    const style = await this.styleModel.findByIdAndUpdate(id, dto, {
      new: true,
    });
    if (!style) throw new NotFoundException('Platform style not found');
    return style;
  }

  async deactivate(id: string): Promise<PlatformStyleDocument> {
    const style = await this.styleModel.findByIdAndUpdate(
      id,
      { is_active: false },
      { new: true },
    );
    if (!style) throw new NotFoundException('Platform style not found');
    return style;
  }

  async seed(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const styleData of seedData) {
      const existing = await this.styleModel.findOne({
        style_code: styleData.style_code,
      });

      if (existing) {
        skipped++;
        continue;
      }

      await this.styleModel.create({
        ...styleData,
        is_active: true,
      });
      created++;
    }

    this.logger.log(`Seed complete: ${created} created, ${skipped} skipped`);
    return { created, skipped };
  }

  async getCategories() {
    const categories = await this.styleModel.distinct('category', {
      is_active: true,
    });
    const counts = await Promise.all(
      categories.map(async (cat) => ({
        category: cat,
        count: await this.styleModel.countDocuments({
          category: cat,
          is_active: true,
        }),
      })),
    );
    return counts;
  }

  /**
   * Copy platform styles into a vendor's product (clothing.styles[])
   * Uses the COPY approach — vendor gets independent copies with optional price overrides.
   */
  async addToProduct(
    productId: string,
    businessId: string,
    platformStyleIds: string[],
    priceOverrides?: Record<string, number>,
  ) {
    // 1. Verify product exists and belongs to vendor
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    if (product.business.toString() !== businessId) {
      throw new NotFoundException('Product not found for this vendor');
    }

    if (product.kind !== 'clothing' || !product.clothing) {
      throw new ConflictException('Only clothing products support styles');
    }

    // 2. Fetch platform styles
    const platformStyles = await this.styleModel.find({
      _id: { $in: platformStyleIds },
      is_active: true,
    });

    if (platformStyles.length === 0) {
      throw new NotFoundException('No active platform styles found');
    }

    // 3. Copy each style into the product
    const existingCodes = new Set(
      (product.clothing.styles || []).map((s: any) => s.style_code),
    );

    const added: string[] = [];
    const skipped: string[] = [];

    for (const ps of platformStyles) {
      if (existingCodes.has(ps.style_code)) {
        skipped.push(ps.name);
        continue;
      }

      const vendorPrice =
        priceOverrides?.[(ps as any)._id.toString()] ?? ps.price_suggestion ?? 0;

      (product.clothing.styles ??= []).push({
        name: ps.name,
        style_code: ps.style_code,
        categories: [ps.category],
        attributes: ps.attributes || [],
        images: ps.image_url
          ? [{ url: ps.image_url, alt_text: ps.name }]
          : [],
        price: vendorPrice,
        type: ps.type,
        notes: ps.description,
        platform_source: (ps as any)._id.toString(),
      } as any);

      added.push(ps.name);
    }

    await product.save();

    this.logger.log(
      `Added ${added.length} platform styles to product ${productId}`,
    );

    return {
      message: `${added.length} style(s) added, ${skipped.length} skipped (already exist)`,
      added,
      skipped,
      product_id: productId,
    };
  }
}
