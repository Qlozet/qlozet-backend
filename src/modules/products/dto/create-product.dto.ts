import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsObject,
  IsNumber,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ImageDto {
  @ApiProperty({ example: 'https://example.com/image.jpg' })
  @IsString()
  url: string;

  @ApiProperty({ example: 'public-id-123' })
  @IsString()
  publicId: string;
}

class SizeDto {
  @ApiProperty({ example: 'M' })
  @IsString()
  size: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ example: 8500 })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ example: 'SKU12345' })
  @IsOptional()
  @IsString()
  sku?: string;
}

class VariantDto {
  @ApiPropertyOptional({
    example: 'Red',
    description: 'Variant color (non-customized product)',
  })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({
    type: ImageDto,
    description: 'Fabric image (customized product)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageDto)
  fabric?: ImageDto;

  @ApiPropertyOptional({
    type: ImageDto,
    description: 'Optional image for variant display',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageDto)
  variantImage?: ImageDto;

  @ApiPropertyOptional({
    example: 3,
    description: 'Yard per order (only for fabric-based customized products)',
  })
  @IsOptional()
  @IsNumber()
  yardPerOrder?: number;

  @ApiProperty({
    type: [SizeDto],
    description: 'Available sizes and quantity for this variant',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeDto)
  sizes: SizeDto[];
}

export class CreateProductDto {
  @ApiProperty({ example: 'Custom Ankara Dress' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Beautiful handmade Ankara dress' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: ['customized', 'non-customized'],
    example: 'customized',
    description: 'Determines if the product is customizable or not',
  })
  @IsEnum(['customized', 'non-customized'], {
    message: 'productMode must be either customized or non-customized',
  })
  productMode: 'customized' | 'non-customized';

  @ApiPropertyOptional({
    example: 'Ankara',
    description: 'Main fabric or material type',
  })
  // @IsOptional()
  // @IsString()
  // material?: string;
  @ApiPropertyOptional({ example: 'Dress' })
  @IsNotEmpty()
  @IsString()
  productType: string;

  @ApiPropertyOptional({ example: 'Traditional' })
  @IsNotEmpty()
  @IsString()
  category: string;

  @ApiPropertyOptional({ example: 'Handmade' })
  @IsNotEmpty()
  @IsString()
  tag: string;

  @ApiPropertyOptional({
    enum: ['active', 'inactive'],
    example: 'active',
    description: 'Product visibility status',
  })
  @IsNotEmpty()
  @IsEnum(['active', 'inactive'])
  status?: string;

  @ApiProperty({
    enum: ['men', 'women', 'unisex'],
    example: 'women',
    description: 'Target audience',
  })
  @IsNotEmpty()
  @IsEnum(['men', 'women', 'unisex'])
  audience: string;

  @ApiProperty({
    type: [VariantDto],
    description: 'List of product variants (colors or fabrics)',
  })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];

  @ApiPropertyOptional({
    type: 'array',
    description:
      'Flexible JSON for customization options (with optional images)',
    example: [
      {
        styles: [
          {
            name: 'style name',
            audience: 'men',
            type: 'tops',
            category: 'coats',
            price: 2500,
            image: {
              url: 'https://example.com/neckline-round.jpg',
              publicId: 'neckline_round',
            },
          },
        ],
      },
    ],
  })
  @ValidateIf((o) => o.productMode === 'customized')
  @IsArray({ message: 'Customizations must be an array' })
  customizations?: Record<string, any>[];
}
