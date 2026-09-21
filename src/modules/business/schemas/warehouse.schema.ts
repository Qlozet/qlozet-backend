import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type WarehouseDocument = Warehouse & Document;

@Schema({ timestamps: true })
export class Warehouse {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  address: string;

  @Prop({ required: true, trim: true })
  contact_name: string;

  @Prop({ required: true, trim: true })
  contact_phone: string;

  @Prop({ required: true, trim: true })
  contact_email: string;

  @Prop({ default: 'active', enum: ['active', 'inactive'] })
  status: 'active' | 'inactive';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;
}

export const WarehouseSchema = SchemaFactory.createForClass(Warehouse);
