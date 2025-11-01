import {
  IsArray,
  IsEnum,
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

// ---------- ROOT PRODUCT FIELDS ----------
export class CreateProductDto {
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
