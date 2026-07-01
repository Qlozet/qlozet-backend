import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ProductKind } from '../../products/schemas/product.schema';

export class CreateSystemCategoryDto {
  @ApiProperty({ enum: ProductKind, description: 'Product kind' })
  @IsEnum(ProductKind)
  kind: string;

  @ApiProperty({ description: 'Product type name (e.g., Dress, Bag, Ankara)' })
  @IsString()
  @IsNotEmpty()
  product_type: string;

  @ApiProperty({
    type: [String],
    description: 'Allowed sub-categories',
    example: ['Maxi', 'Mini', 'Midi'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @ApiProperty({
    type: [String],
    description: 'Allowed attribute descriptors',
    example: ['Summer', 'Cotton', 'Formal'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attributes?: string[];

  @ApiPropertyOptional({ description: 'Icon or emoji for UI display' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ description: 'Sort order for display', default: 0 })
  @IsNumber()
  @IsOptional()
  sort_order?: number;

  @ApiPropertyOptional({ description: 'Whether this category is active', default: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
