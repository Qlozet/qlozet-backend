import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Platform-curated bespoke starting points. A template is NOT a design —
// it has no customer, no fabric, no quotes. "Using" one clones its images
// and selections into the customer's own studio session; the resulting
// design belongs entirely to the customer.

export type BespokeTemplateDocument = BespokeTemplate & Document;

@Schema({ timestamps: true })
export class BespokeTemplate {
  @Prop({ required: true, trim: true })
  name: string;

  // Garment category as the studio understands it (Dresses, Kaftan, …).
  @Prop({ required: true })
  category: string;

  @Prop({ required: true, enum: ['men', 'women'] })
  gender: string;

  @Prop({ type: [String], default: [] })
  design_images: string[];

  // Admin-uploaded inspiration photos — seeded into the customer's studio
  // Photo & Notes alongside the prompt.
  @Prop({ type: [String], default: [] })
  reference_images: string[];

  // Same JSON contract as BespokeDesign.description:
  // { notes, selections: { neckline, sleeve, silhouette, collar, color, … }, userPrompt }
  @Prop({ type: String, default: null })
  description: string;

  // Inactive templates stay editable in the admin console but never
  // appear on the shop.
  @Prop({ type: String, enum: ['active', 'inactive'], default: 'inactive' })
  status: 'active' | 'inactive';

  // Honest social proof — incremented each time a customer opens the
  // template into their studio.
  @Prop({ type: Number, default: 0 })
  uses: number;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  created_by: Types.ObjectId;
}

export const BespokeTemplateSchema =
  SchemaFactory.createForClass(BespokeTemplate);

BespokeTemplateSchema.index({ status: 1, createdAt: -1 });
