import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PermissionDocument = Permission & Document;

export enum PermissionModule {
  USER_MANAGEMENT = 'user_management',
  VENDOR_MANAGEMENT = 'vendor_management',
  PRODUCT_MANAGEMENT = 'product_management',
  ORDER_MANAGEMENT = 'order_management',
  CONTENT_MANAGEMENT = 'content_management',
  FINANCIAL_MANAGEMENT = 'financial_management',
  SYSTEM_MANAGEMENT = 'system_management',
  SUPPORT_MANAGEMENT = 'support_management',
  ANALYTICS = 'analytics',
}

@Schema({ timestamps: true })
export class Permission {
  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  name: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ required: true, trim: true })
  action: string;

  @Prop({ required: true, trim: true })
  resource: string;

  @Prop({
    required: true,
    enum: PermissionModule,
  })
  module: PermissionModule;

  @Prop({ default: true })
  isActive: boolean;
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);
