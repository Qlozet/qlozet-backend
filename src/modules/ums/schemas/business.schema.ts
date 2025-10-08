import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type BusinessDocument = Business & Document;

@Schema({ timestamps: true })
export class Business {
  @Prop({ required: true, trim: true })
  businessName: string;

  @Prop({ required: false, unique: true, lowercase: true, trim: true }) // Made optional
  businessEmail?: string;

  @Prop({ required: false }) // Made optional
  businessPhoneNumber?: string;

  @Prop({ required: true })
  businessAddress: string;

  @Prop()
  addressLine2?: string;

  @Prop()
  billingAddressLine2?: string;

  @Prop()
  timeZone?: string;

  @Prop()
  country?: string;

  @Prop()
  state?: string;

  @Prop()
  city?: string;

  @Prop()
  zipCode?: string;

  @Prop()
  bvn?: string;

  @Prop()
  nin?: string;

  @Prop({ required: true })
  personalName: string;

  @Prop({ required: true })
  personalPhoneNumber: string;

  @Prop({ required: false }) // Made optional
  displayPictureUrl?: string;

  @Prop()
  website?: string;

  @Prop({ type: [String], default: [] })
  cacDocumentUrl?: string[];

  @Prop({ required: false }) // Made optional
  businessLogoUrl?: string;

  @Prop({ required: false }) // Made optional
  coverImageUrl?: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: null })
  verificationToken?: string;

  @Prop({ default: false })
  verificationTokenUsed?: boolean;

  @Prop({ default: null })
  verificationTokenExpiration?: Date;

  @Prop({
    type: [
      {
        user: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
        comment: String,
        rating: { type: Number, min: 1, max: 5 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  reviews?: Array<{
    user: MongooseSchema.Types.ObjectId;
    comment: string;
    rating: number;
    createdAt: Date;
  }>;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  successfulDeliveries?: number;

  @Prop({ default: 0 })
  returnedDeliveries?: number;

  @Prop({ default: 0 })
  totalItemsSold?: number;

  @Prop({ default: 0 })
  successRate?: number;

  @Prop({ default: false })
  isFeatured?: boolean;

  @Prop({ default: 0 })
  earnings?: number;

  @Prop()
  yearFounded?: string;

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [] })
  followers?: MongooseSchema.Types.ObjectId[];

  @Prop({ default: true })
  isActive?: boolean;

  @Prop({ default: false })
  twoFactorAuth?: boolean;

  @Prop({ default: null })
  twoFactorCode?: string;

  @Prop({ default: null })
  twoFactorCodeExpiration?: Date;

  @Prop({
    type: {
      general: {
        enableOrderConfirmation: { type: Boolean, default: true },
        enableOrderNotifications: { type: Boolean, default: true },
      },
      notifications: {
        orderStatus: { type: Boolean, default: true },
        returnsAndRefunds: { type: Boolean, default: true },
        orderTracking: { type: Boolean, default: true },
      },
      customization: {
        dailyOrderLimit: { type: Number, default: 0 },
      },
      workerSettings: {
        maxWorkers: { type: Number, default: 10 },
        allowWorkerInvites: { type: Boolean, default: true },
        requireApproval: { type: Boolean, default: true },
      },
    },
    default: {},
  })
  orderSettings?: {
    general: {
      enableOrderConfirmation: boolean;
      enableOrderNotifications: boolean;
    };
    notifications: {
      orderStatus: boolean;
      returnsAndRefunds: boolean;
      orderTracking: boolean;
    };
    customization: {
      dailyOrderLimit: number;
    };
    workerSettings: {
      maxWorkers: number;
      allowWorkerInvites: boolean;
      requireApproval: boolean;
    };
  };

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  vendor: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: MongooseSchema.Types.ObjectId;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
