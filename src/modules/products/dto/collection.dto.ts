import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Single condition item for filtering products in a collection.
 */
export class ConditionDto {
  @ApiProperty({
    description:
      'Field name on the product to evaluate (e.g. "product_category", "brand", "price")',
    example: 'product_category',
  })
  @IsString()
  field: string;

  @ApiProperty({
    description: 'Operator to compare the field value',
    example: 'is_equal_to',
    enum: ['is_equal_to', 'not_equal_to', 'greater_than', 'less_than'],
  })
  @IsString()
  operator: string;

  @ApiProperty({
    description: 'Value to compare the product field against',
    example: 'Suits',
  })
  @IsString()
  value: string;
}

/**
 * DTO for creating a vendor product collection.
 */
export class CreateCollectionDto {
  @ApiProperty({
    description: 'Title of the collection',
    example: 'New Season Suits',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Short description of the collection',
    example: 'A curated selection of premium suits for the new season.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description:
      'Defines whether all or any conditions must match for a product to belong to the collection',
    enum: ['all', 'any'],
    default: 'all',
    example: 'all',
  })
  @IsEnum(['all', 'any'])
  condition_match: 'all' | 'any';

  @ApiProperty({
    description:
      'List of conditions to filter matching products for this collection',
    type: [ConditionDto],
    example: [
      {
        field: 'product_category',
        operator: 'is_equal_to',
        value: 'Suits',
      },
      {
        field: 'price',
        operator: 'greater_than',
        value: '50000',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions: ConditionDto[];

  @ApiPropertyOptional({
    description: 'Whether the collection is currently active',
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/**
 * DTO for updating a collection (all fields optional).
 */
export class UpdateCollectionDto {
  @ApiPropertyOptional({ example: 'Updated Collection Title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['all', 'any'] })
  @IsOptional()
  @IsEnum(['all', 'any'])
  condition_match?: 'all' | 'any';

  @ApiPropertyOptional({ type: [ConditionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions?: ConditionDto[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/cover.jpg' })
  @IsOptional()
  @IsString()
  cover_image?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  sort_order?: number;
}

/**
 * DTO for creating a platform-wide collection (Admin only).
 */
export class CreatePlatformCollectionDto extends CreateCollectionDto {
  @ApiPropertyOptional({
    description: 'URL-safe slug for the collection (auto-generated from title if not provided)',
    example: 'trending-ankara-styles',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({
    description: 'Cover image URL for homepage/explore display',
    example: 'https://cdn.qlozet.com/collections/trending-ankara.jpg',
  })
  @IsOptional()
  @IsString()
  cover_image?: string;

  @ApiPropertyOptional({
    description: 'Sort order for display on homepage',
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  sort_order?: number;
}
