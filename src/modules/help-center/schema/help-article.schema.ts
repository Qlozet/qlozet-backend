import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// One collection carries the whole help center: FAQs (question-titled
// shorts), how-to guides, and policy pages. The distinction is editorial,
// not structural — `featured` surfaces the FAQ row, `category` groups the
// guides, `audience` decides which app(s) show it.

export type HelpArticleDocument = HelpArticle & Document;

@Schema({ timestamps: true })
export class HelpArticle {
  @Prop({ required: true, trim: true })
  title: string;

  // Markdown. May contain {{platform_setting_key}} placeholders — public
  // reads interpolate them from the live settings document so policy
  // numbers can never drift from what the backend enforces.
  @Prop({ required: true })
  body: string;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ type: String, enum: ['customer', 'vendor', 'both'], default: 'both' })
  audience: 'customer' | 'vendor' | 'both';

  // Unpublished articles are drafts — admin-only.
  @Prop({ type: Boolean, default: false })
  published: boolean;

  // Featured articles render in the "Frequently asked" row.
  @Prop({ type: Boolean, default: false })
  featured: boolean;

  // Manual sort within a category (lower first).
  @Prop({ type: Number, default: 0 })
  order: number;

  @Prop({ type: Number, default: 0 })
  views: number;

  @Prop({ type: Number, default: 0 })
  helpful_yes: number;

  @Prop({ type: Number, default: 0 })
  helpful_no: number;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  created_by: Types.ObjectId;
}

export const HelpArticleSchema = SchemaFactory.createForClass(HelpArticle);

HelpArticleSchema.index({ published: 1, audience: 1, category: 1, order: 1 });
HelpArticleSchema.index({ title: 'text', body: 'text' });
