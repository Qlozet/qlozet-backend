import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FabricDto } from './fabric.dto';
import { CreateStyleDto } from './style.dto';
import { TaxonomyDto } from './taxonomy.dto';
import { ProductImageDto } from './product-image.dto';
import { AccessoryDto } from './accessory.dto';
import { ColorDto } from './product.dto';

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

  @ApiProperty({ example: 7, description: 'Production turnaround days' })
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
  @ValidateNested()
  @Type(() => TaxonomyDto)
  taxonomy: TaxonomyDto;

  @ApiProperty({
    enum: ['active', 'draft', 'archived'],
    description: 'Publication status',
    example: 'active',
  })
  @IsEnum(['active', 'draft', 'archived'])
  status: 'active' | 'draft' | 'archived';

  // ✅ Images
  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Product images with optional style hotspots',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  // ✅ Styles (only allowed for CUSTOMIZE)
  @ValidateIf((o) => o.type === ClothingType.CUSTOMIZE)
  @ApiPropertyOptional({
    type: [CreateStyleDto],
    description: 'Custom styles (only for customize type)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStyleDto)
  styles?: CreateStyleDto[];

  @ValidateIf((o) => o.type === ClothingType.CUSTOMIZE)
  @ApiPropertyOptional({
    type: [AccessoryDto],
    description: 'Attached accessories (only for customize type)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessoryDto)
  accessories?: AccessoryDto[];

  @ApiProperty({
    type: [ColorDto],
    description: 'Color variants allowed for all types',
    example: [
      {
        name: 'White',
        hex: '#fff',
        images: [
          {
            public_id: 'qlozet/fabrics/royal-blue-cotton',
            url: 'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/royal-blue-cotton.jpg',
            width: 800,
            height: 600,
          },
          {
            public_id: 'qlozet/fabrics/navy-blue-cotton',
            url: 'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/navy-blue-cotton.jpg',
            width: 800,
            height: 600,
          },
        ],
        variants: [
          {
            size: 'L',
            stock: 15,
            price: 16000,
            sku: 'QZT-KFTN-L-BLUE',
          },
        ],
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColorDto)
  color_variants?: ColorDto[];

  @ValidateIf((o) => o.type === ClothingType.CUSTOMIZE)
  @ApiPropertyOptional({
    type: [FabricDto],
    description: 'Fabric variants (only for customize type)',
    example: [
      {
        name: 'Qlozet Royal Blue Cotton',
        description:
          'High-thread-count royal blue cotton fabric with a soft, breathable finish. Ideal for kaftans and agbadas.',
        product_type: 'cotton',
        colors: [
          { name: 'Royal Blue', hex: '#2A2A72' },
          { name: 'Navy Blue', hex: '#1E3A8A' },
        ],
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
          {
            public_id: 'qlozet/fabrics/navy-blue-cotton',
            url: 'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/navy-blue-cotton.jpg',
            width: 800,
            height: 600,
          },
        ],
        variants: [
          {
            size: 'L',
            stock: 15,
            price: 16000,
            sku: 'QZT-KFTN-L-BLUE',
            yard_per_order: 5,
          },
          {
            size: 'XL',
            stock: 10,
            price: 17000,
            sku: 'QZT-KFTN-XL-BLUE',
            yard_per_order: 6,
          },
        ],
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FabricDto)
  fabrics?: FabricDto[];
}
