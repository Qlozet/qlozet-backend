import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, IsString } from 'class-validator';

export class DiscountConditionDto {
  @ApiProperty()
  @IsString()
  field: string;

  @ApiProperty()
  @IsString()
  operator: string;

  @ApiProperty()
  @IsString()
  value: string;
}

export class CreateDiscountDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  value: number;

  @ApiProperty()
  value_type: string;

  @ApiProperty()
  required_discount: boolean;

  @ApiProperty()
  condition_match: string;

  @ApiProperty({ type: [DiscountConditionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountConditionDto)
  conditions: DiscountConditionDto[];

  @ApiProperty({ required: false })
  start_date?: Date;

  @ApiProperty({ required: false })
  end_date?: Date;

  @ApiProperty()
  is_active: boolean;
}
