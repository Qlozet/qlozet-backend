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
        selections: {
          type: {
            color_variant_selections: [
              {
                color_variant_id: { type: Types.ObjectId },
                size: String,
                quantity: { type: Number, min: 1 },
              },
            ],
            fabric_selections: [
              {
                fabric_id: { type: Types.ObjectId },
                yardage: Number,
                size: String,
                quantity: { type: Number, min: 1 },
              },
            ],
            style_selections: [
              {
                style_id: { type: Types.ObjectId },
              },
            ],
            accessory_selections: [
              {
                accessory_id: { type: Types.ObjectId },
                variant_id: { type: Types.ObjectId },
                quantity: { type: Number, min: 1 },
              },
            ],
            addon_selections: [
              {
                addon_id: { type: Types.ObjectId },
                variant_id: { type: Types.ObjectId },
                quantity: { type: Number, min: 1 },
              },
            ],
          },
          default: {},
        },
        applied_fabric_id: {
          type: Types.ObjectId,
          ref: 'Product',
          default: null,
        },
        applied_fabric_yards: { type: Number, default: null },
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
    selections?: {
      color_variant_selections?: {
        color_variant_id: Types.ObjectId;
        size?: string;
        quantity?: number;
      }[];
      fabric_selections?: {
        fabric_id: Types.ObjectId;
        yardage?: number;
        size?: string;
        quantity?: number;
      }[];
      style_selections?: {
        style_id: Types.ObjectId;
      }[];
      accessory_selections?: {
        accessory_id: Types.ObjectId;
        variant_id: Types.ObjectId;
        quantity?: number;
      }[];
      addon_selections?: {
        addon_id: Types.ObjectId;
        variant_id: Types.ObjectId;
        quantity?: number;
      }[];
    };
    applied_fabric_id?: Types.ObjectId;
    applied_fabric_yards?: number;
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
