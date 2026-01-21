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
import { ProductImageDto } from './product-image.dto';

export enum AudienceType {
  MEN = 'men',
  WOMEN = 'women',
  UNISEX = 'unisex',
  KIDS = 'kids',
}

export class CreateStyleDto {
  @ApiProperty({ example: 'Classic Dress Shirt', description: 'Style name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'CDS-001', description: 'Unique style code' })
  @IsString()
  style_code: string;

  @ApiProperty({ example: ['shirts', 'formal'], description: 'Categories' })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  categories: string[];

  @ApiProperty({ type: [ProductImageDto], description: 'Style images' })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images: ProductImageDto[];

  @ApiProperty({
    example: ['dress', 'formal'],
    description: 'Style tags',
  })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  attributes?: string[];

  @ApiProperty({ example: 70, description: 'Base price', minimum: 0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  price: number;

  @ApiProperty({
    example: 60,
    description: 'Minimum width in cm',
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  min_width_cm?: number;

  @ApiPropertyOptional({
    example: 'Standard dress shirt',
    description: 'Additional notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: 'neckline',
    description: 'Customization fields',
  })
  @IsNotEmpty()
  @IsString()
  type: string;
}
