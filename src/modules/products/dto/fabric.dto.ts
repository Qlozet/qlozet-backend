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
import { ImageDto } from './product.dto';

export class FabricDto {
  @ApiProperty({ description: 'Fabric name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Fabric description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'cotton', description: 'Product type' })
  @IsString()
  product_type: string;

  @ApiPropertyOptional({ type: [String], description: 'Available colors' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  colors?: string[];

  @ApiPropertyOptional({ example: 'striped', description: 'Pattern style' })
  @IsOptional()
  @IsString()
  pattern?: string;

  @ApiProperty({ example: 2, description: 'Yard length per roll' })
  @IsNumber()
  @Min(0.1)
  yard_length: number;

  @ApiProperty({ example: 60, description: 'Fabric width in inches' })
  @IsNumber()
  @Min(10)
  width: number;

  @ApiProperty({ example: 1, description: 'Minimum cut in yards' })
  @IsNumber()
  @Min(0.1)
  min_cut: number;

  @ApiProperty({ example: 2500, description: 'Price per yard' })
  @IsNumber()
  @Min(0)
  price_per_yard: number;

  @ApiPropertyOptional({ type: [ImageDto], description: 'Fabric images' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];
}
