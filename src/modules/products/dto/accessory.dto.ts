// accessory.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VariantDto } from './base.dto';

export class AccessoryDto {
  @ApiProperty({ example: 'Leather Belt' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'High-quality genuine leather' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'belt' })
  @IsString()
  product_type: string;

  @ApiProperty({ example: 'accessories' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ example: 'belts' })
  @IsOptional()
  @IsString()
  subcategory?: string;

  @ApiPropertyOptional({ example: ['leather', 'formal'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ type: [VariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];
}
