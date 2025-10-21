import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateAccessoryDto } from './product.dto';
import { VariantDto } from './variant.dto';
import { FabricDto } from './fabric.dto';
import { CreateStyleDto } from './style.dto';
import { TaxonomyDto } from './taxonomy.dto';
import { ProductImageDto } from './product-image.dto';

export class ClothingDto {
  @ApiProperty({
    description: 'Clothing name',
    example: 'Qlozet Premium Kaftan',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Detailed product description',
    example:
      'Tailored premium kaftan made from high-quality cotton, designed for comfort and cultural elegance.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 7,
    description: 'Production turnaround days (number of days to complete)',
  })
  @IsNumber()
  @Min(0)
  turnaround_days: number;

  @ApiPropertyOptional({
    description: 'Whether clothing can be customized by customer',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  is_customizable?: boolean;

  @ApiProperty({
    type: TaxonomyDto,
    description: 'Product categorization and tags',
    example: {
      product_type: 'Clothing',
      category: 'Men’s Wear',
      sub_category: 'Kaftan',
      tags: ['traditional', 'cotton', 'qlozet', 'men'],
      audience: 'men',
    },
  })
  @ValidateNested({ each: true })
  @Type(() => TaxonomyDto)
  taxonomy: TaxonomyDto;

  @ApiProperty({
    enum: ['active', 'draft', 'archived'],
    description: 'Publication status of the product',
    example: 'active',
  })
  @IsEnum(['active', 'draft', 'archived'])
  status: 'active' | 'draft' | 'archived';

  @ApiProperty({
    example: 15000,
    description: 'Base price in Naira',
  })
  @IsNumber()
  @Min(0)
  base_price: number;

  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Product images with optional style hotspots',
    example: [
      {
        public_id: 'qlozet/products/denim-jacket-1',
        url: 'https://res.cloudinary.com/qlozet/image/upload/v1/products/denim-jacket-1.jpg',
        width: 1200,
        height: 1600,
        hotspots: [
          {
            id: 'hotspot1',
            image_id: 'qlozet/products/denim-jacket-1',
            field_key: 'collar_style',
            label: 'Classic Collar',
            x: 0.45,
            y: 0.1,
            anchor: 'center',
            radius: 12,
            zIndex: 1,
          },
        ],
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @ApiPropertyOptional({
    type: [CreateStyleDto],
    description: 'Available custom styles (if customizable)',
    example: [
      {
        name: 'Classic Fit',
        style_code: 'CF-001',
        audience: 'men',
        categories: ['traditional', 'formal'],
        tags: ['kaftan', 'premium'],
        price: 16000,
        min_width_cm: 60,
        notes: 'Slim fit kaftan with embroidered neckline',
        fields: {
          neckline: {
            label: 'Neckline Type',
            options: [
              { name: 'Round Neck', price_effect: 0 },
              { name: 'V-Neck', price_effect: 1000 },
            ],
          },
        },
      },
    ],
  })
  @ValidateIf((o) => o.is_customizable === true)
  @IsArray({ message: 'Styles must be an array when customizable' })
  @ValidateNested({ each: true })
  @Type(() => CreateStyleDto)
  styles?: CreateStyleDto[];

  @ApiPropertyOptional({
    type: [CreateAccessoryDto],
    description: 'Attached accessories (e.g., matching cap or bracelet)',
    example: [
      {
        name: 'Qlozet Hausa Cap',
        description: 'Handwoven matching cap with custom embroidery',
        base_price: 5000,
        taxonomy: {
          category: 'Accessories',
          subcategory: 'Caps',
          tags: ['hausa', 'traditional', 'men'],
        },
        variants: [
          { color: 'Cream', size: 'M', price: 5500, stock: 10 },
          { color: 'Brown', size: 'L', price: 5700, stock: 8 },
        ],
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAccessoryDto)
  accessory?: CreateAccessoryDto[];

  @ApiPropertyOptional({
    type: [VariantDto],
    description: 'Available color or size variants',
    example: [
      {
        colors: [{ hex: '#2A2A72' }],
        size: 'L',
        stock: 15,
        price: 16000,
        sku: 'QZT-KFTN-L-BLUE',
        attributes: { fabric: 'cotton', sleeve: 'long' },
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  color_variants?: VariantDto[];

  @ApiPropertyOptional({
    type: [FabricDto],
    description: 'Available fabric variants for this clothing',
    example: [
      {
        name: 'Royal Blue Cotton',
        description: 'High-thread-count cotton fabric with smooth finish',
        product_type: 'cotton',
        colors: ['royal blue', 'navy blue'],
        pattern: 'plain',
        yard_length: 2.5,
        width: 60,
        min_cut: 1,
        price_per_yard: 2500,
        images: [
          {
            public_id: 'qlozet/fabrics/royal-blue-cotton',
            url: 'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/royal-blue-cotton.jpg',
            width: 800,
            height: 600,
          },
        ],
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FabricDto)
  fabric_variants?: FabricDto[];
}
