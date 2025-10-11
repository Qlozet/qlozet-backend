// base.dto.ts
import { Types } from 'mongoose';
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ColorDto {
  @ApiProperty({ example: '#FF0000', description: 'Hex color code' })
  @IsString()
  hex: string;
}

export class ImageDto {
  @ApiProperty({ example: 'image_123', description: 'Cloudinary public ID' })
  @IsString()
  publicId: string;

  @ApiProperty({
    example: 'https://example.com/image.jpg',
    description: 'Image URL',
  })
  @IsString()
  url: string;
}
export class VariantDto {
  @ApiPropertyOptional({ type: [ColorDto], description: 'Variant colors' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColorDto)
  colors?: ColorDto[];

  @ApiPropertyOptional({ example: 'M', description: 'Size variant' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({
    type: [ImageDto],
    description: 'Variant specific images',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiProperty({ example: 10, description: 'Stock quantity', minimum: 0 })
  @IsNumber()
  @Min(0)
  stock: number;

  @ApiProperty({ example: 75, description: 'Variant price', minimum: 0 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: 'SHIRT-M-BLUE',
    description: 'Stock keeping unit',
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    example: { chest: '38-40', waist: '34-36' },
    description: 'Measurement range',
  })
  @IsOptional()
  @IsObject()
  measurement_range?: Record<string, any>;

  @ApiPropertyOptional({
    example: { material: 'cotton' },
    description: 'Additional attributes',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}
