import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class TaxonomyDto {
  @ApiProperty({ description: 'Type of product (e.g., clothing, accessory)' })
  @IsString()
  product_type: string;

  @ApiProperty({ description: 'Main category name' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ description: 'Sub-category name' })
  @IsOptional()
  @IsString()
  sub_category?: string;

  @ApiPropertyOptional({ type: [String], description: 'Associated tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Target audience (e.g., men, women)' })
  @IsOptional()
  @IsString()
  audience?: string;
}
