import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type UserDocument = User & Document;

export enum UserType {
  PLATFORM = 'platform',
  VENDOR = 'vendor',
  CUSTOMER = 'customer',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  full_name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, unique: true })
  phone_number: string;

  @Prop({ required: true, select: false })
  hashed_password: string;

  @Prop({ required: true, enum: UserType, default: UserType.CUSTOMER })
  type: UserType;

  @Prop({ type: Date })
  dob?: Date;

  @Prop({ default: false })
  email_verified: boolean;

  @Prop({ type: String, select: false })
  email_verification_token?: string;

  @Prop({ type: Date, select: false })
  email_verification_expires?: Date;

  @Prop({
    type: {
      pin: String,
      expire_at: Date,
    },
    select: false,
  })
  password_reset_code?: { pin: string; expire_at: Date };

  @Prop({
    default:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQB2J8Tc056dMI-wNe0vmFtByW-ySbA3bY3nQ&s',
  })
  profile_picture: string;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
  })
  status: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', default: null })
  business?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Role', required: true })
  role: Types.ObjectId;

  @Prop({ type: String, select: true })
  refresh_token?: string;

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'Product', default: [] })
  wishlist?: Types.ObjectId[];

  @Prop({ type: [String], default: [] })
  email_preferences?: string[];

  @Prop({ type: Date })
  last_verification_email_sent?: Date;

  @Prop({ type: Date })
  last_welcome_email_sent?: Date;

  @Prop({ type: Number, default: 0 })
  verification_email_attempts?: number;

  @Prop({ type: Date })
  email_verified_at?: Date;
  @Prop({ type: String, default: 'woman' })
  wears_preference: string;

  @Prop({ type: [String], default: [] })
  aesthetic_preferences: string[];

  @Prop({ type: [String], default: [] })
  body_fit: string[];

  @Prop({ type: Boolean, default: false })
  is_email_preference_selected: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email_verification_token: 1 });
UserSchema.index({ email_verification_expires: 1 });
UserSchema.index({ status: 1, email_verified: 1 });
