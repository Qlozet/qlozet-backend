import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  IsBoolean,
  ValidateIf,
  IsDate,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DiscountConditionDto {
  @ApiProperty({
    description:
      'The product field to match (e.g., product_category, price, etc.)',
  })
  @IsString()
  field: string;

  @ApiProperty({
    description: 'The comparison operator (e.g., is_equal_to, greater_than)',
  })
  @IsString()
  operator: string;

  @ApiProperty({ description: 'The target value to match against' })
  @IsString()
  value: string;
}

export class CreateDiscountDto {
  @ApiProperty({
    description: 'Discount type',
    enum: [
      'fixed',
      'percentage',
      'store_wide',
      'flash_fixed',
      'flash_percentage',
      'category_specific',
    ],
  })
  @IsString()
  @IsIn([
    'fixed',
    'percentage',
    'store_wide',
    'flash_fixed',
    'flash_percentage',
    'category_specific',
  ])
  type: string;

  @ApiProperty({ description: 'Discount value (amount or percentage)' })
  @IsNumber()
  value: number;

  @ApiPropertyOptional({
    description:
      'Whether the value is fixed or percentage (required for fixed/percentage types)',
    enum: ['fixed', 'percentage'],
  })
  @ValidateIf((o) => ['fixed', 'percentage'].includes(o.type))
  @IsString()
  value_type?: string;

  @ApiProperty({
    description: 'Whether another discount must exist before applying this one',
  })
  @IsBoolean()
  required_discount: boolean;

  @ApiProperty({
    description: 'Whether all or any conditions must match',
    enum: ['all', 'any'],
  })
  @IsString()
  condition_match: string;

  @ApiProperty({
    description: 'Discount conditions used to match products',
    type: [DiscountConditionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountConditionDto)
  conditions: DiscountConditionDto[];

  // ✅ Only required for flash discounts
  @ApiPropertyOptional({
    description: 'Start date (required only for flash discounts)',
    type: Date,
  })
  @ValidateIf((o) => ['flash_fixed', 'flash_percentage'].includes(o.type))
  @Type(() => Date)
  @IsDate({ message: 'start_date must be a valid date' })
  start_date?: Date;

  @ApiPropertyOptional({
    description: 'End date (required only for flash discounts)',
    type: Date,
  })
  @ValidateIf((o) => ['flash_fixed', 'flash_percentage'].includes(o.type))
  @Type(() => Date)
  @IsDate({ message: 'end_date must be a valid date' })
  end_date?: Date;

  @ApiProperty({ description: 'Whether the discount is active' })
  @IsBoolean()
  is_active: boolean;
}
