import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import OpenAI from 'openai';
import {
  PlatformStyle,
  PlatformStyleDocument,
} from './schemas/platform-style.schema';
import {
  CreatePlatformStyleDto,
  UpdatePlatformStyleDto,
  QueryPlatformStyleDto,
} from './dto/platform-style.dto';
import seedData = require('./data/seed-styles.json');
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class StyleLibraryService {
  private readonly logger = new Logger(StyleLibraryService.name);
  private openai: OpenAI;

  constructor(
    @InjectModel(PlatformStyle.name)
    private readonly styleModel: Model<PlatformStyleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey: apiKey || 'dummy' });
  }

  async create(dto: CreatePlatformStyleDto): Promise<PlatformStyleDocument> {
    const existing = await this.styleModel.findOne({
      style_code: dto.style_code,
    });
    if (existing) {
      throw new ConflictException(
        `Style with code "${dto.style_code}" already exists`,
      );
    }

    // Auto-generate image if not provided
    if (!dto.image_url) {
      dto.image_url = await this.generateStyleImage(dto.name, dto.category, dto.description);
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

  /**
   * Return all active platform styles as a flat array (for matching).
   */
  async findAllActive(): Promise<PlatformStyleDocument[]> {
    return this.styleModel.find({ is_active: true }).lean();
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

  async seed(): Promise<{ created: number; skipped: number; failed: number }> {
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const styleData of seedData) {
      const existing = await this.styleModel.findOne({
        style_code: styleData.style_code,
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Auto-generate image
      let image_url: string | undefined;
      try {
        image_url = await this.generateStyleImage(
          styleData.name,
          styleData.category,
          styleData.description,
        );
      } catch (err) {
        this.logger.warn(`Image generation failed for ${styleData.name}: ${err.message}`);
        failed++;
      }

      await this.styleModel.create({
        ...styleData,
        image_url,
        is_active: true,
      });
      created++;
    }

    this.logger.log(`Seed complete: ${created} created, ${skipped} skipped, ${failed} image failures`);
    return { created, skipped, failed };
  }

  async regenerateImages(): Promise<{ message: string; total: number }> {
    const stylesWithoutImages = await this.styleModel.find({
      $or: [{ image_url: null }, { image_url: '' }, { image_url: { $exists: false } }],
      is_active: true,
    });

    if (stylesWithoutImages.length === 0) {
      return { message: 'All styles already have images', total: 0 };
    }

    // Fire-and-forget: process in background to avoid request timeout
    this.processImageGeneration(stylesWithoutImages).catch((err) =>
      this.logger.error(`Background image generation failed: ${err.message}`),
    );

    return {
      message: `Started generating images for ${stylesWithoutImages.length} styles in background. Check server logs for progress.`,
      total: stylesWithoutImages.length,
    };
  }

  private async processImageGeneration(styles: PlatformStyleDocument[]): Promise<void> {
    let updated = 0;
    let failed = 0;

    for (const style of styles) {
      const imageUrl = await this.generateStyleImage(
        style.name,
        style.category,
        style.description,
      );

      if (imageUrl) {
        await this.styleModel.updateOne({ _id: style._id }, { image_url: imageUrl });
        updated++;
        this.logger.log(`[${updated}/${styles.length}] ✅ ${style.name}`);
      } else {
        failed++;
        this.logger.warn(`[${updated + failed}/${styles.length}] ❌ ${style.name}`);
      }
    }

    this.logger.log(`Image generation complete: ${updated} updated, ${failed} failed out of ${styles.length}`);
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

  // ─── Image Generation ───

  /**
   * Generate a minimal fashion sketch using DALL-E and upload to Cloudinary.
   * Returns the Cloudinary URL or undefined if generation fails.
   */
  public async generateStyleImage(
    name: string,
    category: string,
    description?: string,
  ): Promise<string | undefined> {
    if (this.openai.apiKey === 'dummy') {
      this.logger.warn('OPENAI_API_KEY not set — skipping image generation');
      return undefined;
    }

    const categoryHint = {
      neckline: `${name} neckline on a women's blouse`,
      sleeve: `${name} sleeve style on a women's blouse`,
      collar: `${name} collar on a shirt`,
      skirt: `${name} skirt silhouette`,
      trouser: `${name} trouser/pant silhouette`,
      full_body: `${name} traditional outfit, full body silhouette`,
      bodice: `${name} bodice style on a dress`,
      hemline: `${name} hemline on a dress`,
      back: `${name} back design on a dress`,
    }[category] || `${name} fashion style`;

    const prompt = `Minimal fashion technical sketch on pure white background. Clean black line drawing of ${categoryHint}. Simple, elegant fashion illustration style. No color, no shading, just clean outlines. Professional fashion design reference sketch. ${description || ''}`.trim();

    try {
      this.logger.log(`Generating image for "${name}"...`);

      const response = await this.openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
      });

      const responseData = response.data?.[0];
      const b64 = (responseData as any)?.b64_json;
      const imageUrl = responseData?.url;

      if (b64) {
        // Direct base64 response — upload to Cloudinary
        const result = await this.cloudinaryService.uploadBase64(
          b64,
          'platform-styles',
        ) as { fileUrl: string };

        this.logger.log(`Image generated and uploaded for "${name}": ${result.fileUrl}`);
        return result.fileUrl;
      } else if (imageUrl) {
        // URL response — download, convert to base64, upload to Cloudinary
        const imageResponse = await fetch(imageUrl);
        const arrayBuffer = await imageResponse.arrayBuffer();
        const downloadedB64 = Buffer.from(arrayBuffer).toString('base64');

        const result = await this.cloudinaryService.uploadBase64(
          downloadedB64,
          'platform-styles',
        ) as { fileUrl: string };

        this.logger.log(`Image generated and uploaded for "${name}": ${result.fileUrl}`);
        return result.fileUrl;
      } else {
        this.logger.warn(`No image data returned for "${name}"`);
        return undefined;
      }
    } catch (err) {
      this.logger.error(`Image generation failed for "${name}": ${err.message}`);
      return undefined;
    }
  }
}
