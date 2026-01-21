import { Document, Types } from 'mongoose';

export interface IBusinessAddress {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
}

export interface IBusinessDocuments {
  cac?: string[];
  identity?: string;
}

export interface IBusiness {
  name: string;
  email: string;
  phone: string;
  address: IBusinessAddress;
  documents: IBusinessDocuments;
  logo?: string;
  coverImage?: string;
  website?: string;
  description?: string;
  yearFounded?: string;
}

export interface IVerification {
  status: 'pending' | 'verified' | 'rejected';
  documentsVerified?: boolean;
  identityVerified?: boolean;
}

export interface IMetrics {
  successfulDeliveries: number;
  returnedDeliveries: number;
  totalItemsSold: number;
  successRate: number;
  earnings: number;
  rating: number;
  reviewCount: number;
}

export interface IOrderSettings {
  confirmation: boolean;
  notifications: boolean;
  dailyLimit: number;
}

export interface IWorkerSettings {
  maxWorkers: number;
  allowInvites: boolean;
  requireApproval: boolean;
}

export interface ISettings {
  order: IOrderSettings;
  workers: IWorkerSettings;
}

export interface IReview {
  user: Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
}

export interface IVendor extends Document {
  hashedPassword: string;
  emailVerified: boolean;
  personalName: string;
  personalPhoneNumber: string;
  nationalIdentityNumber: string;
  business: IBusiness;
  verification: IVerification;
  metrics: IMetrics;
  settings: ISettings;
  followers: Types.ObjectId[];
  reviews: IReview[];
  isFeatured: boolean;
  wallet?: Types.ObjectId;
  isActive: boolean;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}
