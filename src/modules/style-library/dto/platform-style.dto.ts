import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsIn,
  ArrayMinSize,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  StyleCategory,
  StyleType,
  StyleGender,
} from '../schemas/platform-style.schema';

export class CreatePlatformStyleDto {
  @ApiProperty({ example: 'V-Neck' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'NECK_V' })
  @IsString()
  style_code: string;

  @ApiProperty({ enum: StyleCategory, example: StyleCategory.NECKLINE })
  @IsEnum(StyleCategory)
  category: StyleCategory;

  @ApiProperty({ enum: StyleType, example: StyleType.TOP })
  @IsEnum(StyleType)
  type: StyleType;

  @ApiPropertyOptional({ enum: StyleGender, example: StyleGender.UNISEX })
  @IsEnum(StyleGender)
  @IsOptional()
  gender?: StyleGender;

  @ApiPropertyOptional({ example: 'A neckline that dips down in a V shape' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/...' })
  @IsString()
  @IsOptional()
  image_url?: string;

  @ApiPropertyOptional({ example: ['V Neckline', 'Plunging Neck'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aliases?: string[];

  @ApiPropertyOptional({ example: ['formal', 'casual', 'flattering'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attributes?: string[];

  @ApiPropertyOptional({ example: 2000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price_suggestion?: number;
}

export class UpdatePlatformStyleDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: StyleCategory })
  @IsEnum(StyleCategory)
  @IsOptional()
  category?: StyleCategory;

  @ApiPropertyOptional({ enum: StyleType })
  @IsEnum(StyleType)
  @IsOptional()
  type?: StyleType;

  @ApiPropertyOptional({ enum: StyleGender })
  @IsEnum(StyleGender)
  @IsOptional()
  gender?: StyleGender;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  image_url?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aliases?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attributes?: string[];

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  price_suggestion?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

/** Bulk-create platform styles - mirrors POST /taxonomy/bulk's shape. */
export class BulkCreatePlatformStylesDto {
  @ApiProperty({ type: [CreatePlatformStyleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePlatformStyleDto)
  items: CreatePlatformStyleDto[];
}

export class QueryPlatformStyleDto {
  @ApiPropertyOptional({ enum: StyleCategory })
  @IsEnum(StyleCategory)
  @IsOptional()
  category?: StyleCategory;

  @ApiPropertyOptional({ enum: StyleType })
  @IsEnum(StyleType)
  @IsOptional()
  type?: StyleType;

  @ApiPropertyOptional({ enum: StyleGender })
  @IsEnum(StyleGender)
  @IsOptional()
  gender?: StyleGender;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  // Admin-only browse controls (ignored for non-platform callers)
  @ApiPropertyOptional({
    enum: ['platform', 'vendor', 'all'],
    description: "Admin: which tier to list. Defaults to 'platform'.",
  })
  @IsIn(['platform', 'vendor', 'all'])
  @IsOptional()
  scope?: 'platform' | 'vendor' | 'all';

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Admin: include soft-deleted (inactive) styles.',
  })
  @IsIn(['true', 'false'])
  @IsOptional()
  include_inactive?: string;
}

export class AddPlatformStylesDto {
  @ApiProperty({ example: ['style_id_1', 'style_id_2'] })
  @IsArray()
  @IsString({ each: true })
  platform_style_ids: string[];

  @ApiPropertyOptional({
    example: { style_id_1: 5000, style_id_2: 3000 },
    description: 'Optional price overrides per style ID',
  })
  @IsOptional()
  price_overrides?: Record<string, number>;
}
