import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  HelpArticle,
  HelpArticleDocument,
} from './schema/help-article.schema';

@Injectable()
export class HelpCenterService {
  constructor(
    @InjectModel(HelpArticle.name)
    private readonly articleModel: Model<HelpArticleDocument>,
    @InjectModel('PlatformSettings')
    private readonly settingsModel: Model<any>,
  ) {}

  /**
   * Replace {{platform_setting_key}} placeholders with live settings values,
   * so policy articles always state what the backend actually enforces.
   * Unknown keys are left visible — a typo should be noticed, not hidden.
   */
  private async interpolate(bodies: string[]): Promise<string[]> {
    if (!bodies.some((b) => b.includes('{{'))) return bodies;
    const settings = (await this.settingsModel.findOne().lean()) ?? {};
    return bodies.map((body) =>
      body.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (match, key) => {
        const value = key
          .split('.')
          .reduce(
            (acc: any, part: string) =>
              acc && typeof acc === 'object' ? acc[part] : undefined,
            settings,
          );
        return value === undefined || value === null ? match : String(value);
      }),
    );
  }

  // ── Public (shop + vendor apps) ──

  async listPublic(audience: 'customer' | 'vendor', search?: string) {
    const filter: Record<string, any> = {
      published: true,
      audience: { $in: [audience, 'both'] },
    };
    if (search?.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const articles = await this.articleModel
      .find(filter)
      .select('title body category featured order views helpful_yes helpful_no')
      .sort(search?.trim() ? { score: { $meta: 'textScore' } } : { category: 1, order: 1, createdAt: -1 })
      .limit(200)
      .lean();

    const bodies = await this.interpolate(articles.map((a) => a.body));
    return {
      message: 'Help articles',
      data: articles.map((a, i) => ({ ...a, body: bodies[i] })),
    };
  }

  async getPublic(id: string) {
    const article = await this.articleModel.findOneAndUpdate(
      { _id: new Types.ObjectId(id), published: true },
      { $inc: { views: 1 } },
      { new: true },
    );
    if (!article) throw new NotFoundException('Article not found');
    const [body] = await this.interpolate([article.body]);
    return { message: 'Help article', data: { ...article.toObject(), body } };
  }

  async feedback(id: string, helpful: boolean) {
    const inc = helpful ? { helpful_yes: 1 } : { helpful_no: 1 };
    const article = await this.articleModel.findOneAndUpdate(
      { _id: new Types.ObjectId(id), published: true },
      { $inc: inc },
      { new: true },
    );
    if (!article) throw new NotFoundException('Article not found');
    return { message: 'Thanks for the feedback', data: { _id: id } };
  }

  // ── Admin CRUD (raw bodies — placeholders stay visible for editing) ──

  async adminList() {
    const articles = await this.articleModel
      .find()
      .sort({ category: 1, order: 1, createdAt: -1 })
      .populate('created_by', 'full_name email')
      .lean();
    return { message: 'Help articles', data: articles };
  }

  async adminGet(id: string) {
    const article = await this.articleModel.findById(id).lean();
    if (!article) throw new NotFoundException('Article not found');
    return { message: 'Help article', data: article };
  }

  async adminCreate(dto: any, adminId?: string) {
    const article = await this.articleModel.create({
      title: dto.title,
      body: dto.body,
      category: dto.category,
      audience: ['customer', 'vendor', 'both'].includes(dto.audience)
        ? dto.audience
        : 'both',
      published: !!dto.published,
      featured: !!dto.featured,
      order: Number(dto.order) || 0,
      created_by: adminId ? new Types.ObjectId(adminId) : null,
    });
    return { message: 'Article created', data: article };
  }

  async adminUpdate(id: string, dto: any) {
    const update: Record<string, any> = {};
    for (const key of [
      'title',
      'body',
      'category',
      'audience',
      'published',
      'featured',
      'order',
    ]) {
      if (dto[key] !== undefined) update[key] = dto[key];
    }
    const article = await this.articleModel.findByIdAndUpdate(id, update, {
      new: true,
    });
    if (!article) throw new NotFoundException('Article not found');
    return { message: 'Article updated', data: article };
  }

  async adminDelete(id: string) {
    const res = await this.articleModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Article not found');
    return { message: 'Article deleted', data: { _id: id } };
  }
}
