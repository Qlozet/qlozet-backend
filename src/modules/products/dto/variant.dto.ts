import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductImageDto } from './product-image.dto';

export class VariantDto {
  @ApiPropertyOptional({ description: 'Variant size (e.g., M, L)' })
  @IsOptional()
  @IsString()
  size: string;

  @ApiProperty({ example: 20, description: 'Stock quantity' })
  @IsNumber()
  @Min(1)
  stock: number;

  @ApiProperty({ example: 5000, description: 'Price of this variant' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: 'SKU-RED-M',
    description: 'Stock keeping unit code',
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    example: 2.5,
    description: 'Yard per order (in yards)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  yard_per_order: number;

  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Variant images',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}
