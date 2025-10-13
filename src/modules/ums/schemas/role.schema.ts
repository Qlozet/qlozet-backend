import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Permission } from './permission.schema';
import { UserType } from './user.schema';

export type RoleDocument = Role & Document;

export enum UserRole {
  CUSTOMER = 'customer',
  VENDOR = 'vendor',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
  MODERATOR = 'moderator',
}

export enum RoleType {
  PLATFORM = 'platform',
  VENDOR = 'vendor',
}

export enum PlatformRole {
  SUPER_ADMIN = 'super_admin',
  MARKETING = 'marketing',
  OPERATIONS = 'operations',
  SALES = 'sales',
  DATA_ANALYST = 'data_analyst',
  MODERATOR = 'moderator',
}

export enum VendorRole {
  ADMIN = 'admin',
  OPERATIONS = 'operations',
  MARKETING = 'marketing',
  DATA_ANALYST = 'data_analyst',
  SALES = 'sales',
}

@Schema({ timestamps: true })
export class Role {
  @Prop({ required: true, trim: true, lowercase: true })
  name: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({
    required: true,
    enum: RoleType,
    default: RoleType.PLATFORM,
  })
  type: RoleType;

  @Prop({ required: true, min: 1, max: 10, default: 5 })
  level: number;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Permission' }],
    default: [],
  })
  permissions: MongooseSchema.Types.ObjectId[];

  @Prop({ default: false })
  is_default: boolean;

  @Prop({ default: false })
  is_system: boolean;

  @Prop({ default: true })
  is_active: boolean;

  @Prop({
    type: [String],
    enum: [UserType.CUSTOMER, UserType.VENDOR, UserType.PLATFORM],
    default: [UserType.CUSTOMER],
  })
  allowed_user_types: string[];
}

export const RoleSchema = SchemaFactory.createForClass(Role);
