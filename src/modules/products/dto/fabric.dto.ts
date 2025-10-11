// fabric.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariantDto } from './base.dto';

export class FabricDto {
  @ApiProperty({ example: 'Pure Mulberry Silk' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '100% pure mulberry silk' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'silk' })
  @IsString()
  productType: string;

  @ApiPropertyOptional({ example: ['#FFEBCD', '#FFF8DC'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  colors?: string[];

  @ApiPropertyOptional({ example: 'plain' })
  @IsOptional()
  @IsString()
  pattern?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.1)
  yardLength: number;

  @ApiProperty({ example: 45 })
  @IsNumber()
  @Min(10)
  width: number;

  @ApiProperty({ example: 0.25 })
  @IsNumber()
  @Min(0.1)
  minCut: number;

  @ApiProperty({ example: 35 })
  @IsNumber()
  @Min(0)
  pricePerYard: number;

  @ApiProperty({ type: [VariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];
}
