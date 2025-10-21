import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Address, AddressSchema } from './address.schema';

export type OrderDocument = Order & Document;

@Schema({ timestamps: true })
export class Order {
  @Prop()
  reference: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;
  @Prop({
    type: [
      {
        product_id: { type: Types.ObjectId, ref: 'Product', required: true },
        selected_items: {
          type: {
            color_variant_ids: {
              type: [{ type: Types.ObjectId, ref: 'ProductColorVariant' }],
              default: [],
            },
            fabric_variant_ids: {
              type: [{ type: Types.ObjectId, ref: 'ProductFabricVariant' }],
              default: [],
            },
            style_ids: {
              type: [{ type: Types.ObjectId, ref: 'ProductStyle' }],
              default: [],
            },
            accessory_ids: {
              type: [{ type: Types.ObjectId, ref: 'ProductAccessory' }],
              default: [],
            },
          },
          default: {},
        },

        quantity: { type: Number, required: true, min: 1 },
        unit_price: { type: Number, required: true },
        total_price: { type: Number, required: true },

        note: { type: String },
      },
    ],
    required: true,
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
  @Prop({
    type: [AddressSchema],
    validate: [
      (val: any[]) =>
        val.every((a) => ['shipping', 'billing'].includes(a.type)),
      'Invalid address type',
    ],
  })
  addresses: Address[];
  @Prop({ type: Number, required: true })
  subtotal: number;

  @Prop({ type: Number, default: 0 })
  shipping_fee: number;

  @Prop({ type: Number, required: true })
  total: number;
  @Prop({
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled'],
    default: 'pending',
  })
  status: string;

  @Prop({ type: String })
  tracking_number?: string;

  @Prop({ type: String })
  courier_name?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
