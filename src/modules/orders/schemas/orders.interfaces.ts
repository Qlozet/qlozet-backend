import { Types } from 'mongoose';
import {
  AccessorySelectionDto,
  FabricSelectionDto,
  StyleSelectionDto,
  VariantSelectionDto,
} from '../dto/selection.dto';

// ENUMS FOR YOUR PRODUCT TYPES
export enum ProductKind {
  CLOTHING = 'clothing',
  FABRIC = 'fabric',
  ACCESSORY = 'accessory',
}

export enum ClothingType {
  CUSTOMIZE = 'customize',
  NON_CUSTOMIZE = 'non_customize',
}

export enum MeasurementUnit {
  INCHES = 'inches',
  CM = 'cm',
}

// SELECTION INTERFACES FOR EACH PRODUCT TYPE
export interface ColorVariantSelection {
  color_variant_id: Types.ObjectId;
  quantity: number;
  size?: string; // For non-customize clothing
}

export interface FabricSelection {
  fabric_id: Types.ObjectId;
  yardage: number;
  cut_length?: number;
  estimated_yardage?: number;
  notes?: string;
}

export interface NormalizedSelections {
  variant_selection?: VariantSelectionDto[];
  style_selection?: StyleSelectionDto[];
  fabric_selection?: FabricSelectionDto[];
  accessory_selection?: AccessorySelectionDto[];
}
export interface AccessorySelection {
  accessory_id: Types.ObjectId;
  variant_id?: Types.ObjectId;
  quantity: number;
  notes?: string;
}

// MAIN ORDER ITEM INTERFACE
export interface ProcessedOrderItem {
  product_id: Types.ObjectId;
  product_kind?: ProductKind;
  clothing_type?: ClothingType; // Only for clothing products
  note?: string;
  total_price: number;

  // Product snapshots at time of order
  product_snapshot?: any;
  clothing_snapshot?: any;
  fabric_snapshot?: any;
  style_snapshot?: any;
  accessory_snapshot?: any;
  discount_snapshot?: any;

  // Selections based on product kind and clothing type
  selections: {
    variant_selection?: VariantSelectionDto[];
    style_selection?: StyleSelectionDto[];
    fabric_selection?: FabricSelectionDto[];
    accessory_selection?: AccessorySelectionDto[];
  };
}
