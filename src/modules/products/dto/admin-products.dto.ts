import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { ProductStatus } from '../enums/product-status.enum';
import { ProductModerationStatus } from '../enums/product-moderation.enum';

const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

const toBoolean = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : value === true || value === 'true';

/**
 * Query for the admin catalogue. Deliberately NOT `FindAllProductsDto`: the
 * public one is force-filtered to active products from approved vendors, so
 * every draft, archived and rejected item — exactly what a moderator needs to
 * see — is invisible through it.
 */
export class AdminFindProductsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(1)
  size?: number = 10;

  @ApiPropertyOptional({ description: 'Product kind (clothing, fabric, accessory)' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({ description: 'Search by product name, category, attribute, SKU or vendor' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Restrict to one vendor' })
  @IsOptional()
  @IsMongoId()
  business_id?: string;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ enum: ProductModerationStatus })
  @IsOptional()
  @IsEnum(ProductModerationStatus)
  moderation_status?: ProductModerationStatus;

  @ApiPropertyOptional({ description: 'Exact product type (e.g. Top)' })
  @IsOptional()
  @IsString()
  product_type?: string;

  @ApiPropertyOptional({ description: 'Category (e.g. T-Shirt)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Audience (men, women, unisex, kids)' })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({ description: "Clothing type ('customize' | 'non_customize')" })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Tag slug or name carried on the product' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ description: 'Minimum effective price' })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum effective price' })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only products currently on sale' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  on_sale?: boolean;

  @ApiPropertyOptional({ description: 'Only products with stock left' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  in_stock?: boolean;

  @ApiPropertyOptional({ description: 'Created on or after this date (ISO)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this date (ISO)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['date', 'price', 'name', 'rating', 'stock'] })
  @IsOptional()
  @IsEnum(['date', 'price', 'name', 'rating', 'stock'])
  sortBy?: 'date' | 'price' | 'name' | 'rating' | 'stock';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}

export class AdminUpdateProductStatusDto {
  @ApiProperty({ enum: ProductStatus, description: 'New publish state' })
  @IsEnum(ProductStatus)
  status: ProductStatus;

  @ApiPropertyOptional({ description: 'Why the admin changed it — kept on the moderation record' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminScheduleActivationDto {
  @ApiProperty({
    description: 'When the product should go live automatically (must be in the future)',
    example: '2026-12-10T10:00:00Z',
  })
  @IsDateString()
  activation_date: string;
}

export class AdminModerateProductDto {
  @ApiPropertyOptional({ description: 'Reason shown to the vendor (required when rejecting)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Partial product update from the admin edit form.
 *
 * The kind sub-documents are taken as plain objects rather than re-declaring
 * the three full create DTOs: an edit sends only the fields that changed, and
 * running the create validators over a partial would reject every one of them
 * for missing required keys. Only the keys present are written.
 */
export class AdminUpdateProductDto {
  @ApiPropertyOptional({ description: 'SEO block, merged over the existing one' })
  @IsOptional()
  @IsObject()
  seo?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Metafields, merged over the existing ones' })
  @IsOptional()
  @IsObject()
  metafields?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Base price' })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber()
  @Min(0)
  base_price?: number;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ description: 'Clothing fields to overwrite' })
  @IsOptional()
  @IsObject()
  clothing?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Accessory fields to overwrite' })
  @IsOptional()
  @IsObject()
  accessory?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Fabric fields to overwrite' })
  @IsOptional()
  @IsObject()
  fabric?: Record<string, any>;
}
