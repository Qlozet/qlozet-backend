import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CartDocument = Cart & Document;

@Schema({ timestamps: true })
export class Cart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({
    type: [
      {
        product_id: { type: Types.ObjectId, ref: 'Product', required: true },
        selected_items: {
          type: {
            color_variant_id: {
              type: Types.ObjectId,
              ref: 'Variant',
            },
            fabric_variant_id: {
              type: Types.ObjectId,
              ref: 'Fabric',
            },
            style_id: { type: Types.ObjectId, ref: 'Style' },
            accessory_id: { type: Types.ObjectId, ref: 'Accessory' },
          },
          default: {},
        },
        quantity: { type: Number, required: true, min: 1 },
        unit_price: { type: Number, required: true },
        total_price: { type: Number, required: true },
        note: { type: String },
      },
    ],
    default: [],
  })
  items: Array<{
    product_id: Types.ObjectId;
    selected_items?: {
      color_variant_ids?: Types.ObjectId[];
      fabric_variant_ids?: Types.ObjectId[];
      style_ids?: Types.ObjectId[];
      accessory_ids?: Types.ObjectId[];
    };
    quantity: number;
    unit_price: number;
    total_price: number;
    note?: string;
  }>;

  @Prop({ type: Number, default: 0 })
  subtotal: number; // sum of all total_price

  @Prop({ type: Number, default: 0 })
  total: number;
}

export const CartSchema = SchemaFactory.createForClass(Cart);
