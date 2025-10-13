import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ClothingDto } from './clothing.dto';
import { AccessoryDto } from './accessory.dto';
import { FabricDto } from './fabric.dto';

// ---------- BASE SUB-DTOS ---------- //

export class ColorDto {
  @ApiProperty({ example: '#FF5733', description: 'Hex code of the color' })
  hex: string;
}

export class ImageDto {
  @ApiProperty({
    example: 'qoobea_img_12345',
    description: 'Public ID of image',
  })
  public_id: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/qoobea_img_12345.jpg',
    description: 'Full image URL',
  })
  url: string;
}

export class ProductImageDto {
  @ApiProperty({ description: 'Unique image ID (linked to product)' })
  @IsString()
  public_id: string;

  @ApiProperty({ description: 'Image URL' })
  @IsUrl()
  url: string;

  @ApiPropertyOptional({ description: 'Image width in px' })
  width?: number;

  @ApiPropertyOptional({ description: 'Image height in px' })
  height?: number;
}

// ---------- ROOT PRODUCT FIELDS ----------
export class CreateProductDto {
  @ApiProperty({ example: 15000, description: 'Base price in Naira' })
  @IsNumber()
  @Min(0)
  base_price: number;

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
    description: 'Type of product (optional for updates)',
  })
  @IsOptional()
  @IsEnum(['clothing', 'fabric', 'accessory'])
  kind?: string;

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
  fabrics?: FabricDto;

  @ApiPropertyOptional({ type: () => AccessoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AccessoryDto)
  accessories?: AccessoryDto;

  @ApiPropertyOptional({ type: () => ClothingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClothingDto)
  clothing?: ClothingDto;
}
