import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class RecommendSizeDto {
  @ApiPropertyOptional({
    description:
      'Fit type name (e.g. "regular", "relaxed"). ' +
      'If omitted, recommendation is based on body measurements only.',
    example: 'regular',
  })
  @IsOptional()
  @IsString()
  fit_type?: string;

  @ApiPropertyOptional({
    description:
      'Override the unit for the response. ' +
      'By default the API returns both cm and inch values.',
    enum: ['cm', 'inch'],
  })
  @IsOptional()
  @IsEnum(['cm', 'inch'])
  preferred_unit?: 'cm' | 'inch';
}

/* ── Response shapes ── */

export class BodyPartBreakdownDto {
  @ApiProperty({ example: 'chest' })
  body_part: string;

  @ApiProperty({ example: 90, description: 'Customer measurement (in guide unit)' })
  customer_value: number;

  @ApiProperty({ example: '88 – 92', description: 'Range for recommended size' })
  range: string;

  @ApiProperty({ example: true })
  fits: boolean;

  @ApiPropertyOptional({ example: 'Between M and L' })
  note?: string;
}

export class GarmentMeasurementDto {
  @ApiProperty({ example: 'chest' })
  body_part: string;

  @ApiProperty({ example: '88 – 92', description: 'Body size range' })
  body_range: string;

  @ApiProperty({ example: '92 – 96', description: 'Garment size range (body + ease)' })
  garment_range: string;

  @ApiProperty({ example: 4, description: 'Fit ease added' })
  ease: number;

  @ApiProperty({ example: 'Regular Fit' })
  fit_label: string;
}

export class RecommendSizeResponseDto {
  @ApiProperty({ example: 'M' })
  recommended_size: string;

  @ApiProperty({ example: 0.85, description: '0-1 confidence score' })
  confidence: number;

  @ApiProperty({ type: [BodyPartBreakdownDto] })
  breakdown: BodyPartBreakdownDto[];

  @ApiPropertyOptional({ type: [GarmentMeasurementDto] })
  garment_measurements?: GarmentMeasurementDto[];

  @ApiProperty({ example: 'cm', description: 'Unit used for all numeric values' })
  unit: string;
}
