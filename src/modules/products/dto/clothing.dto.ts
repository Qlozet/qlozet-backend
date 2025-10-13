import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductImageDto } from './product.dto';
import { VariantDto } from './variant.dto';
import { FabricDto } from './fabric.dto';
import { CreateStyleDto, StyleFieldDto } from './style.dto';
import { TaxonomyDto } from './taxonomy.dto';

export class ClothingDto {
  @ApiProperty({ description: 'Clothing name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 7, description: 'Production turnaround days' })
  @IsNumber()
  @Min(0)
  turnaround_days: number;

  @ApiPropertyOptional({ description: 'Whether clothing is customizable' })
  @IsOptional()
  @IsBoolean()
  is_customizable?: boolean;

  @ApiProperty({ type: TaxonomyDto, description: 'Taxonomy' })
  @ValidateNested({ each: true })
  @Type(() => TaxonomyDto)
  taxonomy: TaxonomyDto;

  @ApiProperty({
    enum: ['active', 'draft', 'archived'],
    description: 'Publication status',
  })
  @IsEnum(['active', 'draft', 'archived'])
  status: 'active' | 'draft' | 'archived';

  @ApiProperty({ example: 15000, description: 'Base price in Naira' })
  @IsNumber()
  @Min(0)
  base_price: number;

  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Product images',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @ApiPropertyOptional({ type: [CreateStyleDto], description: 'Styles' })
  @ValidateIf((o) => o.is_customizable === true)
  @IsArray({ message: 'Styles must be an array when product is customizable' })
  @ValidateNested({ each: true })
  @Type(() => CreateStyleDto)
  styles?: CreateStyleDto[];

  @ApiPropertyOptional({ type: [VariantDto], description: 'Color variants' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  color_variants?: VariantDto[];

  @ApiPropertyOptional({ type: [FabricDto], description: 'Fabric variants' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FabricDto)
  fabric_variants?: FabricDto[];
}
