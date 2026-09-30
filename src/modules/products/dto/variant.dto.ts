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
  // Min(0), not Min(1): zero stock is a normal state - a size that is sold
  // out, or one the vendor has not counted yet. Requiring at least one
  // rejected the whole product save with
  // "accessory.variants.0.stock must not be less than 1", so a vendor could
  // not save a catalogue that had anything out of stock.
  @IsOptional()
  @IsNumber()
  @Min(0)
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
  @Min(0)
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
