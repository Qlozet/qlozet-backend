import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ImageDto } from './image.dto';
import { Types } from 'mongoose';
import { VariantDto } from './base.dto';

// style.dto.ts
export class StyleFieldOptionDto {
  @ApiProperty({ example: 'French Cuff', description: 'Option name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 10, description: 'Price effect' })
  @IsOptional()
  @IsNumber()
  price_effect?: number;

  @ApiPropertyOptional({ example: 0.1, description: 'Yardage effect' })
  @IsOptional()
  @IsNumber()
  yardage_effect?: number;
}

export class StyleFieldDto {
  @ApiProperty({ example: 'Cuff Style', description: 'Field label' })
  @IsString()
  label: string;

  @ApiProperty({ type: [StyleFieldOptionDto], description: 'Field options' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StyleFieldOptionDto)
  options: StyleFieldOptionDto[];
}

export class CreateStyleDto {
  @ApiProperty({ example: 'Classic Dress Shirt', description: 'Style name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'CDS-001', description: 'Unique style code' })
  @IsString()
  style_code: string;

  @ApiProperty({
    enum: ['men', 'women', 'unisex', 'kids'],
    example: 'men',
    description: 'Target audience',
  })
  @IsEnum(['men', 'women', 'unisex', 'kids'])
  audience: string;

  @ApiProperty({ example: ['shirts', 'formal'], description: 'Categories' })
  @IsArray()
  @IsString({ each: true })
  categories: string[];

  @ApiPropertyOptional({
    example: ['dress', 'formal'],
    description: 'Style tags',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [ImageDto], description: 'Style images' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiPropertyOptional({ example: 70, description: 'Base price', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    example: 60,
    description: 'Minimum width in cm',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_width_cm?: number;

  @ApiPropertyOptional({
    example: 'Standard dress shirt',
    description: 'Additional notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: {
      collar_style: {
        label: 'Collar Style',
        options: [
          { name: 'Standard Point', price_effect: 0 },
          { name: 'Spread Collar', price_effect: 5 },
        ],
      },
    },
    description: 'Customization fields',
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, StyleFieldDto>;
  @ApiProperty({ type: [VariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];
}

export class StyleResponseDto {
  @ApiProperty({ example: '67a1b2c3d4e5f67890123460', description: 'Style ID' })
  _id: Types.ObjectId;

  @ApiProperty({ example: 'Classic Dress Shirt', description: 'Style name' })
  name: string;

  @ApiProperty({ example: 'CDS-001', description: 'Unique style code' })
  styleCode: string;

  @ApiProperty({
    enum: ['men', 'women', 'unisex', 'kids'],
    example: 'men',
    description: 'Target audience',
  })
  audience: string;

  @ApiProperty({ example: ['shirts', 'formal'], description: 'Categories' })
  categories: string[];

  @ApiPropertyOptional({
    example: ['dress', 'formal'],
    description: 'Style tags',
  })
  tags?: string[];

  @ApiPropertyOptional({ type: [ImageDto], description: 'Style images' })
  images?: ImageDto[];

  @ApiPropertyOptional({ example: 70, description: 'Base price' })
  price?: number;

  @ApiPropertyOptional({ example: 60, description: 'Minimum width in cm' })
  minWidthCm?: number;

  @ApiPropertyOptional({
    example: 'Standard dress shirt',
    description: 'Additional notes',
  })
  notes?: string;

  @ApiPropertyOptional({ description: 'Customization fields' })
  fields?: Record<string, StyleFieldDto>;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Creation timestamp',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Last update timestamp',
  })
  updatedAt: Date;
}
