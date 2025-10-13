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
import { ColorDto, ImageDto } from './product.dto';

export class VariantDto {
  @ApiPropertyOptional({ type: [ColorDto], description: 'Color variants' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColorDto)
  colors?: ColorDto[];

  @ApiPropertyOptional({ description: 'Variant size (e.g., M, L)' })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({ type: [ImageDto], description: 'Variant images' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiProperty({ example: 20, description: 'Stock quantity' })
  @IsNumber()
  @Min(0)
  stock: number;

  @ApiProperty({ example: 5000, description: 'Price of this variant' })
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

  @ApiPropertyOptional({ description: 'Measurement range for custom orders' })
  @IsOptional()
  @IsObject()
  measurement_range?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Additional variant attributes' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}
