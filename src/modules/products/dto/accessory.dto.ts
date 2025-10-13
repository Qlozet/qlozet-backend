import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariantDto } from './variant.dto';
import { ImageDto } from './product.dto';
import { TaxonomyDto } from './taxonomy.dto';

export class AccessoryDto {
  @ApiProperty({ description: 'Accessory name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Accessory description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 5000, description: 'Base price in Naira' })
  @IsNumber()
  @Min(0)
  base_price: number;

  @ApiProperty({ type: TaxonomyDto, description: 'Taxonomy' })
  @ValidateNested({ each: true })
  @Type(() => TaxonomyDto)
  taxonomy: TaxonomyDto;

  @ApiProperty({ type: [VariantDto], description: 'Accessory variants' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];

  @ApiPropertyOptional({ type: [ImageDto], description: 'Accessory images' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];
}
