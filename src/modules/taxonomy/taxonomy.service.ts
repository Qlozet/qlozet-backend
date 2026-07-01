import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SystemCategory,
  SystemCategoryDocument,
} from './schemas/system-category.schema';
import { SystemTag, SystemTagDocument } from './schemas/system-tag.schema';
import { CreateSystemCategoryDto } from './dto/create-system-category.dto';
import { UpdateSystemCategoryDto } from './dto/update-system-category.dto';
import { CreateSystemTagDto } from './dto/create-system-tag.dto';
import { UpdateSystemTagDto } from './dto/update-system-tag.dto';
import { SEED_CATEGORIES, SEED_TAGS } from './seed-taxonomy.data';

@Injectable()
export class TaxonomyService {
  private readonly logger = new Logger(TaxonomyService.name);

  constructor(
    @InjectModel(SystemCategory.name)
    private readonly categoryModel: Model<SystemCategoryDocument>,
    @InjectModel(SystemTag.name)
    private readonly tagModel: Model<SystemTagDocument>,
  ) {}

  // ─────────────────────────────────────────────────────────
  // CATEGORIES — Public Queries
  // ─────────────────────────────────────────────────────────

  /**
   * Returns the full taxonomy tree grouped by kind.
   * Used by frontend for dropdowns and LLM constraints.
   */
  async getTree(kind?: string) {
    const filter: any = { is_active: true };
    if (kind) filter.kind = kind;

    const categories = await this.categoryModel
      .find(filter)
      .sort({ sort_order: 1, product_type: 1 })
      .lean();

    // Group by kind
    const tree: Record<string, any> = {};
    for (const cat of categories) {
      if (!tree[cat.kind]) {
        tree[cat.kind] = { product_types: [] };
      }
      tree[cat.kind].product_types.push({
        _id: cat._id,
        name: cat.product_type,
        categories: cat.categories,
        attributes: cat.attributes,
        icon: cat.icon || null,
        sort_order: cat.sort_order,
      });
    }

    return tree;
  }

  /**
   * Returns just the product_type names for a given kind.
   * Used for populating the first-level dropdown.
   */
  async getProductTypes(kind: string) {
    const categories = await this.categoryModel
      .find({ kind, is_active: true })
      .sort({ sort_order: 1 })
      .select('product_type icon')
      .lean();

    return categories.map((c) => ({
      name: c.product_type,
      icon: c.icon || null,
    }));
  }

  /**
   * Returns the allowed sub-categories for a specific product_type.
   * Used for populating the second-level dropdown.
   */
  async getCategoriesForType(kind: string, productType: string) {
    const category = await this.categoryModel
      .findOne({ kind, product_type: productType, is_active: true })
      .lean();

    if (!category) {
      throw new NotFoundException(
        `No category found for kind="${kind}", product_type="${productType}"`,
      );
    }

    return {
      product_type: category.product_type,
      categories: category.categories,
      attributes: category.attributes,
    };
  }

  // ─────────────────────────────────────────────────────────
  // CATEGORIES — Admin CRUD
  // ─────────────────────────────────────────────────────────

  async createCategory(dto: CreateSystemCategoryDto) {
    try {
      const category = await this.categoryModel.create(dto);
      this.logger.log(
        `Created category: ${dto.kind}/${dto.product_type}`,
      );
      return category;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `Category "${dto.product_type}" already exists for kind "${dto.kind}"`,
        );
      }
      throw error;
    }
  }

  async bulkImportCategories(items: CreateSystemCategoryDto[]) {
    try {
      const result = await this.categoryModel.insertMany(items, {
        ordered: false,
      });
      this.logger.log(`Bulk imported ${result.length} categories`);
      return {
        inserted: result.length,
        total: items.length,
        items: result,
      };
    } catch (error) {
      // insertMany with ordered:false continues on duplicate key errors
      if (error.code === 11000 || error.writeErrors) {
        const inserted = error.insertedDocs?.length || 0;
        const skipped = items.length - inserted;
        this.logger.log(
          `Bulk import: ${inserted} inserted, ${skipped} skipped (duplicates)`,
        );
        return {
          inserted,
          skipped,
          total: items.length,
          items: error.insertedDocs || [],
        };
      }
      throw error;
    }
  }

  async updateCategory(id: string, dto: UpdateSystemCategoryDto) {
    const category = await this.categoryModel.findByIdAndUpdate(id, dto, {
      new: true,
    });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    this.logger.log(`Updated category: ${category.kind}/${category.product_type}`);
    return category;
  }

  async deleteCategory(id: string) {
    const category = await this.categoryModel.findByIdAndDelete(id);
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    this.logger.log(`Deleted category: ${category.kind}/${category.product_type}`);
    return { deleted: true, id };
  }

  // ─────────────────────────────────────────────────────────
  // TAGS — Public Queries
  // ─────────────────────────────────────────────────────────

  async getTags(filters?: { assignable_by?: string; kind?: string }) {
    const query: any = { is_active: true };
    if (filters?.assignable_by) query.assignable_by = filters.assignable_by;
    if (filters?.kind) {
      query.$or = [{ kind: filters.kind }, { kind: null }];
    }

    return this.tagModel.find(query).sort({ sort_order: 1, name: 1 }).lean();
  }

  // ─────────────────────────────────────────────────────────
  // TAGS — Admin CRUD
  // ─────────────────────────────────────────────────────────

  async createTag(dto: CreateSystemTagDto) {
    const slug = this.generateSlug(dto.name);
    try {
      const tag = await this.tagModel.create({ ...dto, slug });
      this.logger.log(`Created tag: ${dto.name} (${slug})`);
      return tag;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(`Tag "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  async updateTag(id: string, dto: UpdateSystemTagDto) {
    const update: any = { ...dto };
    if (dto.name) {
      update.slug = this.generateSlug(dto.name);
    }
    const tag = await this.tagModel.findByIdAndUpdate(id, update, {
      new: true,
    });
    if (!tag) {
      throw new NotFoundException(`Tag with id "${id}" not found`);
    }
    this.logger.log(`Updated tag: ${tag.name}`);
    return tag;
  }

  async deleteTag(id: string) {
    const tag = await this.tagModel.findByIdAndDelete(id);
    if (!tag) {
      throw new NotFoundException(`Tag with id "${id}" not found`);
    }
    this.logger.log(`Deleted tag: ${tag.name}`);
    return { deleted: true, id };
  }

  // ─────────────────────────────────────────────────────────
  // SEED
  // ─────────────────────────────────────────────────────────

  async seed(force = false) {
    let categoriesDeleted = 0;
    let tagsDeleted = 0;

    if (force) {
      const catResult = await this.categoryModel.deleteMany({});
      const tagResult = await this.tagModel.deleteMany({});
      categoriesDeleted = catResult.deletedCount || 0;
      tagsDeleted = tagResult.deletedCount || 0;
      this.logger.warn(
        `Force seed: deleted ${categoriesDeleted} categories and ${tagsDeleted} tags`,
      );
    }

    const categoryResult = await this.bulkImportCategories(SEED_CATEGORIES);
    
    // Seed tags one by one to handle slug generation
    let tagsInserted = 0;
    let tagsSkipped = 0;
    for (const tagData of SEED_TAGS) {
      try {
        await this.createTag(tagData);
        tagsInserted++;
      } catch (error) {
        if (error instanceof ConflictException) {
          tagsSkipped++;
        } else {
          throw error;
        }
      }
    }

    this.logger.log(
      `Seed complete: ${categoryResult.inserted} categories, ${tagsInserted} tags`,
    );

    return {
      forced: force,
      deleted: force ? { categories: categoriesDeleted, tags: tagsDeleted } : undefined,
      categories: categoryResult,
      tags: { inserted: tagsInserted, skipped: tagsSkipped },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
}
