// src/dto/selection.dto.ts
import { Types } from 'mongoose';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsPositive,
  ValidateNested,
  IsMongoId,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** -------------------- COLOR SELECTION -------------------- */
export class VariantSelectionDto {
  @IsMongoId()
  variant_id: Types.ObjectId;

  @IsString()
  @IsOptional()
  size: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  quantity: number;
}

/** -------------------- FABRIC SELECTION -------------------- */
export class FabricSelectionDto {
  @IsMongoId()
  fabric_id: Types.ObjectId;

  @IsNumber()
  @Min(0.1)
  yardage: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  quantity: number;
}

/** -------------------- STYLE SELECTION -------------------- */
export class StyleSelectionDto {
  @IsMongoId()
  style_id: Types.ObjectId;
}

/** -------------------- ACCESSORY SELECTION -------------------- */
export class AccessorySelectionDto {
  @IsMongoId()
  accessory_id: Types.ObjectId;

  @IsMongoId()
  variant_id: Types.ObjectId;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  quantity: number;
}

/** -------------------- ORDER ITEM SELECTIONS -------------------- */
export class OrderItemSelectionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantSelectionDto)
  @IsOptional()
  variant_selections?: VariantSelectionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FabricSelectionDto)
  @IsOptional()
  fabric_selections?: FabricSelectionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StyleSelectionDto)
  @IsOptional()
  style_selections?: StyleSelectionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessorySelectionDto)
  @IsOptional()
  accessory_selections?: AccessorySelectionDto[];
}
