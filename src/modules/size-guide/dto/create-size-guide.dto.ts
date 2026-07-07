import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsNumber,
  IsIn,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SUPPORTED_BODY_PARTS } from 'src/common/constants/body-parts.constant';

/* ── Sub-DTOs ── */

export class SizeMeasurementRangeDto {
  @ApiProperty({ example: 'chest', enum: SUPPORTED_BODY_PARTS })
  @IsString()
  body_part: string;

  @ApiProperty({ example: 84 })
  @IsNumber()
  @Min(0)
  min: number;

  @ApiProperty({ example: 88 })
  @IsNumber()
  @Min(0)
  max: number;
}

export class SizeEntryDto {
  @ApiProperty({ example: 'M' })
  @IsString()
  label: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsNumber()
  sort_order?: number;

  @ApiProperty({ type: [SizeMeasurementRangeDto] })
  @ValidateNested({ each: true })
  @Type(() => SizeMeasurementRangeDto)
  @IsArray()
  @ArrayMinSize(1)
  measurements: SizeMeasurementRangeDto[];
}

export class FitAllowanceDto {
  @ApiProperty({ example: 'chest', enum: SUPPORTED_BODY_PARTS })
  @IsString()
  body_part: string;

  @ApiProperty({ example: 4, description: 'Ease value in the guide\'s unit (cm or inches)' })
  @IsNumber()
  value: number;
}

export class FitTypeDto {
  @ApiProperty({ example: 'regular' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Regular Fit' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ example: 'True to size, comfortable without excess room' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [FitAllowanceDto] })
  @ValidateNested({ each: true })
  @Type(() => FitAllowanceDto)
  @IsArray()
  allowances: FitAllowanceDto[];
}

export class ConditionDto {
  @ApiProperty({ example: 'kind' })
  @IsString()
  field: string;

  @ApiProperty({ example: 'equals' })
  @IsString()
  operator: string;

  @ApiProperty({ example: 'clothing' })
  @IsString()
  value: string;
}

/* ── Main DTO ── */

export class CreateSizeGuideDto {
  @ApiProperty({ example: "Men's Traditional Wear Size Chart" })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Size chart for Agbada, Kaftan, and Senator styles' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'] })
  @IsEnum(['cm', 'inch'])
  unit: 'cm' | 'inch';

  @ApiProperty({
    example: ['chest', 'waist', 'hip', 'shoulder_breadth'],
    enum: SUPPORTED_BODY_PARTS,
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  body_parts: string[];

  @ApiProperty({ type: [SizeEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => SizeEntryDto)
  @IsArray()
  @ArrayMinSize(1)
  sizes: SizeEntryDto[];

  @ApiProperty({ type: [FitTypeDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FitTypeDto)
  @IsArray()
  fit_types?: FitTypeDto[];

  @ApiProperty({ example: 'all', enum: ['all', 'any'], default: 'all' })
  @IsOptional()
  @IsEnum(['all', 'any'])
  condition_match?: 'all' | 'any';

  @ApiProperty({ type: [ConditionDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  @IsArray()
  conditions?: ConditionDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
