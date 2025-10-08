import { Types } from 'mongoose';
// import { ProductStatus } from './schemas/product.schema';

export interface ProductUpdateData {
  name?: string;
  price?: number;
  usdPrice?: number;
  description?: string;
  quantity?: number;
  // status?: ProductStatus;
  isFeatured?: boolean;
  isOnSale?: boolean;
  pickupAvailable?: boolean;
  customStyles?: Array<{
    imageIndex: number;
    id: Types.ObjectId;
    price: number;
    position: { left: number; right: number; top: number; bottom: number };
  }>;
  sizeOptions?: Array<{ size: string; quantityAvailable: number }>;
  images?: Array<{
    secure_url: string;
    public_id: string;
    asset_id: string;
    order?: number;
  }>;
  designs?: Types.ObjectId[];
  colors?: Types.ObjectId[];
  subcategories?: Types.ObjectId[];
  discountPercentage?: number;
}
