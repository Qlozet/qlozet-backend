import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/* ── Nested shapes ── */

class SizeMeasurementRangeResponseDto {
  @ApiProperty({ example: 'chest' }) body_part: string;
  @ApiProperty({ example: 84 }) min: number;
  @ApiProperty({ example: 88 }) max: number;
}

class SizeEntryResponseDto {
  @ApiProperty({ example: 'M' }) label: string;
  @ApiProperty({ example: 1 }) sort_order: number;
  @ApiProperty({ type: [SizeMeasurementRangeResponseDto] })
  measurements: SizeMeasurementRangeResponseDto[];
}

class FitAllowanceResponseDto {
  @ApiProperty({ example: 'chest' }) body_part: string;
  @ApiProperty({ example: 4 }) value: number;
}

class FitTypeResponseDto {
  @ApiProperty({ example: 'regular' }) name: string;
  @ApiProperty({ example: 'Regular Fit' }) label: string;
  @ApiPropertyOptional({ example: 'True to size' }) description?: string;
  @ApiProperty({ type: [FitAllowanceResponseDto] })
  allowances: FitAllowanceResponseDto[];
}

class ConditionResponseDto {
  @ApiProperty({ example: 'kind' }) field: string;
  @ApiProperty({ example: 'equals' }) operator: string;
  @ApiProperty({ example: 'clothing' }) value: string;
}

/* ── Main response ── */

export class SizeGuideResponseDto {
  @ApiProperty({ example: '665a1f2e3b4c5d6e7f8a9b0c' }) _id: string;
  @ApiProperty({ example: "Men's Traditional Wear Size Chart" }) title: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ example: '665a1f2e3b4c5d6e7f8a9b0d' }) business: string;

  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'] }) unit: string;
  @ApiProperty({ example: ['chest', 'waist', 'hip'] }) body_parts: string[];
  @ApiProperty({ type: [SizeEntryResponseDto] }) sizes: SizeEntryResponseDto[];
  @ApiProperty({ type: [FitTypeResponseDto] }) fit_types: FitTypeResponseDto[];

  @ApiProperty({ example: 'all', enum: ['all', 'any'] }) condition_match: string;
  @ApiProperty({ type: [ConditionResponseDto] }) conditions: ConditionResponseDto[];
  @ApiProperty({ example: [] }) manual_includes: string[];
  @ApiProperty({ example: [] }) manual_excludes: string[];
  @ApiProperty({ example: true }) is_active: boolean;

  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class SizeGuideForProductResponseDto {
  @ApiProperty({ example: '665a1f2e3b4c5d6e7f8a9b0c' }) _id: string;
  @ApiProperty({ example: "Men's Traditional Wear Size Chart" }) title: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ example: 'cm', enum: ['cm', 'inch'] }) unit: string;
  @ApiProperty({ example: ['chest', 'waist', 'hip'] }) body_parts: string[];
  @ApiProperty({ type: [SizeEntryResponseDto] }) sizes: SizeEntryResponseDto[];
  @ApiProperty({ type: [FitTypeResponseDto] }) fit_types: FitTypeResponseDto[];
}
