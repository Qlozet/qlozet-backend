// base.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  IsEnum,
  IsMongoId,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Types } from 'mongoose';

export class ColorDto {
  @ApiProperty({ example: '#FF0000' })
  @IsString()
  hex: string;
}

export class ImageDto {
  @ApiProperty({ example: 'image_123' })
  @IsString()
  publicId: string;

  @ApiProperty({ example: 'https://example.com/image.jpg' })
  @IsString()
  url: string;
}

export class VariantDto {
  @ApiPropertyOptional({ type: [ColorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColorDto)
  colors?: ColorDto[];

  @ApiPropertyOptional({ example: 'M' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ type: [ImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0)
  stock: number;

  @ApiProperty({ example: 75 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'PRODUCT-SKU-001' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ example: { chest: '38-40', waist: '34-36' } })
  @IsOptional()
  @IsObject()
  measurement_range?: Record<string, any>;

  @ApiPropertyOptional({ example: { material: 'cotton' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}
