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
import { AccessoryDto } from './accessory.dto';

export enum ClothingType {
  CUSTOMIZE = 'customize',
  NON_CUSTOMIZE = 'non_customize',
}

export class ClothingDto {
  @ApiProperty({
    description: 'Clothing name',
    example: 'Qlozet Premium Kaftan',
  })
  @IsString()
  name: string;

  @ApiProperty({
    enum: ClothingType,
    description:
      'Type of clothing - customize (made-to-order) or non-customize (ready-to-wear)',
    example: ClothingType.CUSTOMIZE,
  })
  @IsEnum(ClothingType)
  type: ClothingType;

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

  @ApiProperty({
    type: TaxonomyDto,
    description: 'Product categorization and tags',
    example: {
      product_type: 'Clothing',
      categories: ['Men’s Wear'],
      attributes: ['traditional', 'cotton', 'qlozet', 'men'],
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
    description:
      'Available custom styles (only required if clothing_type is "customize")',
    example: [
      {
        name: 'Classic Fit Kaftan',
        style_code: 'CF-001',
        categories: ['traditional'],
        attributes: ['premium', 'custom'],
        price: 16000,
        min_width_cm: 60,
        notes: 'Slim fit kaftan with embroidered neckline',
        type: 'Neckline',
        variants: [
          {
            size: 'M',
            price: 16000,
            stock: 10,
            sku: 'CF-M',
          },
        ],
      },
    ],
  })
  @ValidateIf((o) => o.clothing_type === ClothingType.CUSTOMIZE)
  @IsArray({ message: 'Styles are required when clothing_type is "customize"' })
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
          product_type: 'accessory',
          categories: ['Belt'],
          attributes: ['leather', 'fashion', 'men', 'qlozet'],
          audience: 'men',
        },
        variant: { color: 'Cream', size: 'M', price: 5500, stock: 10 },
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessoryDto)
  accessories?: AccessoryDto[];

  @ApiPropertyOptional({
    type: [VariantDto],
    description:
      'Available color or size variants (primarily for non-customize clothing)',
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
  @ValidateIf((o) => o.clothing_type === ClothingType.NON_CUSTOMIZE)
  @IsArray({
    message:
      'Color variants are required when clothing_type is "non_customize"',
  })
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];

  @ApiPropertyOptional({
    type: [FabricDto],
    description:
      'Available fabric variants for this clothing (primarily for customize clothing)',
    example: [
      {
        name: 'Royal Blue Cotton',
        description: 'High-thread-count cotton fabric with smooth finish',
        product_type: 'cotton',
        colors: [{ hex: '#2A2A72' }],
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
  @ValidateIf((o) => o.clothing_type === ClothingType.CUSTOMIZE)
  @IsArray({
    message: 'Fabric variants are required when clothing_type is "customize"',
  })
  @ValidateNested({ each: true })
  @Type(() => FabricDto)
  fabrics?: FabricDto[];
}
