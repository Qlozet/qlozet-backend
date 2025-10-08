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
  fullName: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, unique: true })
  phoneNumber: string;

  @Prop({ required: true, select: false })
  hashedPassword: string;

  @Prop({
    required: true,
    enum: UserType,
    default: UserType.CUSTOMER,
  })
  type: UserType;

  @Prop({ type: Date })
  dob?: Date;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ type: String, select: false })
  emailVerificationToken?: string;

  @Prop({ type: Date, select: false })
  emailVerificationExpires?: Date;

  @Prop({
    default:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQB2J8Tc056dMI-wNe0vmFtByW-ySbA3bY3nQ&s',
  })
  profilePicture: string;

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

  @Prop({
    type: {
      pin: String,
      expireAt: Date,
    },
    select: false,
  })
  verification?: { pin: string; expireAt: Date };

  @Prop({
    type: {
      pin: String,
      expireAt: Date,
    },
    select: false,
  })
  passwordResetCode?: { pin: string; expireAt: Date };

  @Prop({ type: String, select: true })
  refreshToken?: string;

  @Prop({
    type: [String],
    enum: ['petite', 'curve', 'plus_size', 'tall', 'hour_glass', 'maternity'],
  })
  bodyFit?: string[];

  @Prop({ type: String, enum: ['man', 'woman', ''], default: '' })
  wearsPreference?: string;

  @Prop({ type: [String], default: [] })
  aestheticPreferences?: string[];

  @Prop({ type: [String], default: [] })
  emailPreferences?: string[];

  @Prop({ default: false })
  isEmailPreferenceSelected?: boolean;

  @Prop({
    type: [
      {
        searchTerm: String,
        searchedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  searchProductHistory?: Array<{ searchTerm: string; searchedAt: Date }>;

  @Prop({
    type: [
      {
        searchTerm: String,
        searchedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  searchCategoryHistory?: Array<{ searchTerm: string; searchedAt: Date }>;

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'Product', default: [] })
  wishlist?: Types.ObjectId[];

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  following?: Types.ObjectId[];

  // New fields for tracking email communication
  @Prop({ type: Date })
  lastWelcomeEmailSent?: Date;

  @Prop({ type: Date })
  lastVerificationEmailSent?: Date;

  @Prop({ type: Number, default: 0 })
  verificationEmailAttempts?: number;

  @Prop({ type: Date })
  emailVerifiedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ emailVerificationToken: 1 });
UserSchema.index({ emailVerificationExpires: 1 });
UserSchema.index({ status: 1, emailVerified: 1 });
