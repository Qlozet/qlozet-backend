import { Document, Types } from 'mongoose';

export interface ISearchHistoryItem {
  searchTerm: string;
  searchedAt: Date;
}

export interface ISearchHistory {
  products: ISearchHistoryItem[];
  categories: ISearchHistoryItem[];
}

export interface INotificationPreferences {
  email?: boolean;
  sms?: boolean;
  push?: boolean;
}

export interface IPreferences {
  email: string[];
  isEmailPreferenceSelected: boolean;
  notifications: INotificationPreferences;
}

export interface IAuth {
  refreshToken?: string;
  resetCode?: string;
  resetCodeExpires?: Date;
  emailVerified: boolean;
  verificationToken?: string;
}

export interface ICustomer extends Document {
  email: string;
  phoneNumber: string;
  password: string;
  fullName: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive';
  profilePicture?: string;
  auth: IAuth;
  wearsPreferences: 'man' | 'woman' | '';
  aestheticPreferences: string[];
  bodyFit: string[];
  dob?: Date;
  wishlist: Types.ObjectId[];
  following: Types.ObjectId[];
  searchHistory: ISearchHistory;
  preferences: IPreferences;
  createdAt: Date;
  updatedAt: Date;
}
