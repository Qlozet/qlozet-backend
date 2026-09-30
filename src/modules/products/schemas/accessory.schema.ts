import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Taxonomy, TaxonomySchema } from './taxonomy.schema';
import { ProductImage, ProductImageSchema } from './product-image.schema';
import { Color, ColorSchema } from './color.schema';

/**
 * One buyable combination of an accessory — a colour, a size, or both.
 *
 * This used to declare only { color, size, stock }, all required, with `size`
 * as an ARRAY. Every other layer disagreed: the DTO, the vendor console and
 * the shop all send and read one row per size with a single `size` string,
 * plus a `sku` and its own images. Mongoose strips unknown paths silently, so
 * those three were accepted by the API, never stored, and therefore never came
 * back to edit or display — the variants looked like they had vanished.
 *
 * Nothing is required now. An accessory may be colour-only (a belt in three
 * leathers), size-only (a cap in S/M/L) or a single unnamed row that exists
 * just to carry stock; rejecting those forced the vendor to invent values.
 *
 * Note there is deliberately no per-variant `price`: an accessory is priced by
 * `accessory.price`, and orders.price-calculation prices it from the product's
 * effective price. A price here would be stored and then ignored at charge
 * time, which is worse than not having one.
 */
@Schema()
export class AccessoryVariant {
  _id?: Types.ObjectId;

  @Prop({ type: ColorSchema })
  color?: Color;

  @Prop({ type: String })
  size?: string;

  @Prop({ min: 0, default: 0 })
  stock: number;

  @Prop()
  sku?: string;

  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];
}

export const AccessoryVariantSchema =
  SchemaFactory.createForClass(AccessoryVariant);

/** ---------------- ACCESSORY ---------------- */
export type AccessoryDocument = Accessory & Document;

@Schema({ timestamps: true, _id: true })
export class Accessory {
  _id?: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: TaxonomySchema, required: true })
  taxonomy: Taxonomy;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop({ type: [AccessoryVariantSchema], required: true, default: [] })
  variants: AccessoryVariant[];

  @Prop({ type: [ProductImageSchema], default: [] })
  images?: ProductImage[];

  @Prop({ default: true })
  in_stock: boolean;
}

export const AccessorySchema = SchemaFactory.createForClass(Accessory);
