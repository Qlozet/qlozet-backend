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

/** ---------------- DISCOUNT CONDITION ---------------- */
export class DiscountConditionDto {
  @ApiProperty({
    description:
      'The product field to match (e.g., product_category, price, etc.)',
    example: 'product_category',
  })
  @IsString()
  field: string;

  @ApiProperty({
    description: 'The comparison operator (e.g., is_equal_to, greater_than)',
    example: 'is_equal_to',
  })
  @IsString()
  operator: string;

  @ApiProperty({
    description: 'The target value to match against',
    example: 'shirts',
  })
  @IsString()
  value: string;
}

/** ---------------- CREATE DISCOUNT ---------------- */
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
    example: 'flash_percentage',
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

  @ApiProperty({
    description: 'Discount value (amount or percentage)',
    example: 20,
  })
  @IsNumber()
  value: number;

  @ApiPropertyOptional({
    description:
      'Whether the value is fixed or percentage (required for fixed/percentage types)',
    enum: ['fixed', 'percentage'],
    example: 'percentage',
  })
  @ValidateIf((o) => ['fixed', 'percentage'].includes(o.type))
  @IsString()
  value_type?: string;

  @ApiProperty({
    description: 'Whether another discount must exist before applying this one',
    example: false,
  })
  @IsBoolean()
  required_discount: boolean;

  @ApiProperty({
    description: 'Whether all or any conditions must match',
    enum: ['all', 'any'],
    example: 'all',
  })
  @IsString()
  condition_match: string;

  @ApiProperty({
    description: 'Discount conditions used to match products',
    type: [DiscountConditionDto],
    example: [
      {
        field: 'product_category',
        operator: 'is_equal_to',
        value: 'accessories',
      },
      {
        field: 'price',
        operator: 'greater_than',
        value: '5000',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountConditionDto)
  conditions: DiscountConditionDto[];

  /** ---------------- FLASH DISCOUNT FIELDS ---------------- */
  @ApiPropertyOptional({
    description: 'Start date (required only for flash discounts)',
    type: Date,
    example: '2025-11-01T08:00:00.000Z',
  })
  @ValidateIf((o) => ['flash_fixed', 'flash_percentage'].includes(o.type))
  @Type(() => Date)
  @IsDate({ message: 'start_date must be a valid date' })
  start_date?: Date;

  @ApiPropertyOptional({
    description: 'End date (required only for flash discounts)',
    type: Date,
    example: '2025-11-05T23:59:59.000Z',
  })
  @ValidateIf((o) => ['flash_fixed', 'flash_percentage'].includes(o.type))
  @Type(() => Date)
  @IsDate({ message: 'end_date must be a valid date' })
  end_date?: Date;

  @ApiProperty({
    description: 'Whether the discount is active',
    example: true,
  })
  @IsBoolean()
  is_active: boolean;
}
