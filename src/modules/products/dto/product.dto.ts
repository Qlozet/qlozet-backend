import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ClothingDto } from './clothing.dto';
import { AccessoryDto } from './accessory.dto';
import { FabricDto } from './fabric.dto';
import { VariantDto } from './variant.dto';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';
import { PaginatedDto } from 'src/common/dto/pagination.dto';

// ---------- BASE SUB-DTOS ---------- //

export class ColorDto {
  @ApiPropertyOptional({ example: 'Red', description: 'Name of the color' })
  @IsString()
  @IsOptional()
  name: string;

  @ApiProperty({ example: '#FF5733', description: 'Hex code of the color' })
  @IsString()
  @IsNotEmpty()
  hex: string;

  @ApiPropertyOptional({
    type: [VariantDto],
    description: 'Available  color variants',
    example: [
      {
        size: 'L',
        stock: 15,
        price: 16000,
        sku: 'QZT-KFTN-L-BLUE',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}

export class CreateProductDto {
  @ApiPropertyOptional({
    description: 'Provide this only if you want to update an existing product',
    example: '677f5c19c918d2e4a8c55123',
  })
  @IsOptional()
  @IsMongoId()
  product_id?: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'SEO metadata',
    example: { title: 'Premium Hausa Cap', keywords: ['cap', 'Hausa'] },
  })
  @IsOptional()
  @IsObject()
  seo?: Record<string, any>;

  @ApiPropertyOptional({
    type: Object,
    description: 'Custom metafields',
    example: { region: 'Maiduguri', material: 'cotton' },
  })
  @IsOptional()
  @IsObject()
  metafields?: Record<string, any>;
}

// ---------- CLOTHING ----------
export class CreateClothingDto extends CreateProductDto {
  @ApiProperty({ type: ClothingDto })
  @ValidateNested()
  @Type(() => ClothingDto)
  clothing: ClothingDto;
}

// ---------- FABRIC ----------
export class CreateFabricDto extends CreateProductDto {
  @ApiProperty({ type: FabricDto })
  @ValidateNested()
  @Type(() => FabricDto)
  fabric: FabricDto;
}

// ---------- ACCESSORY ----------
export class CreateAccessoryDto extends CreateProductDto {
  @ApiProperty({ type: AccessoryDto })
  @ValidateNested()
  @Type(() => AccessoryDto)
  accessory: AccessoryDto;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional({
    enum: ['clothing', 'fabric', 'accessory'],
    description: 'Type of product',
  })
  @IsNotEmpty()
  @IsEnum(['clothing', 'fabric', 'accessory'])
  kind: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'SEO metadata object (title, keywords, etc.)',
    example: {
      title: 'Updated Hausa Cap',
      keywords: ['cap', 'Hausa', 'traditional'],
    },
  })
  @IsOptional()
  @IsObject()
  seo?: Record<string, any>;

  @ApiPropertyOptional({
    type: Object,
    description: 'Custom metafields for product',
    example: { region: 'Kaduna', season: 'Dry' },
  })
  @IsOptional()
  @IsObject()
  metafields?: Record<string, any>;

  @ApiPropertyOptional({ type: () => FabricDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FabricDto)
  fabric?: FabricDto;

  @ApiPropertyOptional({ type: () => AccessoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AccessoryDto)
  accessory?: AccessoryDto;

  @ApiPropertyOptional({ type: () => ClothingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClothingDto)
  clothing?: ClothingDto;
}

export class ProductListResponseDto extends BaseResponseDto {
  @ApiProperty({
    example: {
      statusCode: 200,
      message: 'Success',
      error: null,
      timestamp: 1763680887587,
      version: 'v1',
      path: '/api/products?page=1&size=10&order=desc',
      data: {
        total_items: 3,
        data: [
          {
            kind: 'fabric',
            name: 'Qlozet Royal Blue Cotton',
            description:
              'High-thread-count royal blue cotton fabric with a soft, breathable finish. Ideal for kaftans and agbadas.',
            base_price: 6250,
            yard_length: 2.5,
            pattern: 'striped',
            width: 60,
            price_per_yard: 2500,
            variants: [
              {
                size: 'L',
                stock: 15,
                price: 16000,
                yard_per_order: 5,
                sku: 'QZT-KFTN-L-BLUE',
                _id: '690f83524d38e9188cc62f2e',
              },
            ],
            createdAt: '2025-11-08T17:52:18.573Z',
            updatedAt: '2025-11-08T17:52:18.573Z',
          },
          {
            kind: 'accessory',
            name: 'Qlozet Leather Belt',
            description:
              'Premium handcrafted leather belt by Qlozet, designed for everyday comfort and durability.',
            price: 5000,
            in_stock: true,
            variants: [
              {
                color: { name: 'Black', hex: '#000' },
                size: ['M'],
                stock: 20,
                _id: '690f82d52a3bb3c49a8812cb',
              },
              {
                color: { name: 'White', hex: '#fff' },
                size: ['M'],
                stock: 20,
                _id: '690f82d52a3bb3c49a8812cc',
              },
            ],
            images: [
              {
                public_id: 'qlozet/accessories/belt-black',
                url: 'https://res.cloudinary.com/qlozet/image/upload/v1/accessories/belt-black.jpg',
                width: 800,
                height: 600,
              },
              {
                public_id: 'qlozet/accessories/belt-brown',
                url: 'https://res.cloudinary.com/qlozet/image/upload/v1/accessories/belt-brown.jpg',
                width: 800,
                height: 600,
              },
            ],
            createdAt: '2025-11-08T17:50:13.513Z',
            updatedAt: '2025-11-13T21:25:19.479Z',
          },
          {
            kind: 'clothing',
            name: 'Qlozet Premium Kaftan',
            description:
              'Tailored premium kaftan made from high-quality cotton, designed for comfort and cultural elegance.',
            base_price: 616320,
            turnaround_days: 7,
            variants: [],
            images: [
              {
                public_id: 'qlozet/products/denim-jacket-1',
                url: 'https://res.cloudinary.com/qlozet/image/upload/v1/products/denim-jacket-1.jpg',
                width: 1200,
                height: 1600,
              },
            ],
            createdAt: '2025-11-08T17:52:12.062Z',
            updatedAt: '2025-11-08T17:52:12.062Z',
          },
        ],
        total_pages: 1,
        current_page: 1,
        has_next_page: false,
        has_previous_page: false,
        page_size: 10,
      },
    },
  })
  data: PaginatedDto<ClothingDto | FabricDto | AccessoryDto>;
}
