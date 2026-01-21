import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum AddressType {
  SHIPPING = 'shipping',
  BILLING = 'billing',
}
@Schema({ timestamps: true })
export class Address {
  @Prop({ required: false })
  full_name?: string;

  @Prop({ required: false })
  phone_number?: string;

  @Prop({ required: true })
  address: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  state?: string;

  @Prop({ required: true })
  country?: string;

  @Prop({ required: true })
  postal_code?: string;

  @Prop()
  address_code?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customer: Types.ObjectId;
}
export type AddressDocument = Address & Document;
export const AddressSchema = SchemaFactory.createForClass(Address);
