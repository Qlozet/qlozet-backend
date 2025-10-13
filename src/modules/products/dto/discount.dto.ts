// create-discount.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
} from 'class-validator';

export class ConditionDto {
  @ApiProperty()
  @IsNotEmpty()
  field: string;

  @ApiProperty()
  @IsNotEmpty()
  operator: string;

  @ApiProperty()
  @IsNotEmpty()
  value: string;
}

export class CreateDiscountDto {
  @ApiProperty({
    enum: [
      'fixed',
      'percentage',
      'store_wide',
      'flash_fixed',
      'flash_percentage',
      'category_specific',
    ],
  })
  @IsEnum([
    'fixed',
    'percentage',
    'store_wide',
    'flash_fixed',
    'flash_percentage',
    'category_specific',
  ])
  type: string;

  @ApiProperty()
  @IsNumber()
  value: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  conditions?: ConditionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['all', 'any'])
  condition_match?: 'all' | 'any';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  end_date?: string;
}
