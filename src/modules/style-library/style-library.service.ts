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

@Injectable()
export class StyleLibraryService {
  private readonly logger = new Logger(StyleLibraryService.name);

  constructor(
    @InjectModel(PlatformStyle.name)
    private readonly styleModel: Model<PlatformStyleDocument>,
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
}
