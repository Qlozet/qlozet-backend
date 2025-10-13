import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DiscountDocument = Discount & Document;

@Schema({ timestamps: true })
export class Discount {
  @Prop({
    required: true,
    enum: [
      'fixed',
      'percentage',
      'store_wide',
      'flash_fixed',
      'flash_percentage',
      'category_specific',
    ],
  })
  type:
    | 'fixed'
    | 'percentage'
    | 'store_wide'
    | 'flash_fixed'
    | 'flash_percentage'
    | 'category_specific';

  @Prop({ required: true, type: Number, min: 0 })
  value: number;

  @Prop({
    required: false,
    enum: ['fixed', 'percentage'],
  })
  value_type?: 'fixed' | 'percentage';

  @Prop({ default: false })
  required_discount: boolean;

  @Prop({ default: 'all', enum: ['all', 'any'] })
  condition_match: 'all' | 'any';

  @Prop([
    {
      field: { type: String, required: true },
      operator: { type: String, required: true },
      value: { type: String, required: true },
    },
  ])
  conditions: { field: string; operator: string; value: string }[];

  @Prop({ type: Date, default: null })
  start_date?: Date;

  @Prop({ type: Date, default: null })
  end_date?: Date;

  @Prop({ default: true })
  is_active: boolean;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  vendor: Types.ObjectId;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);
