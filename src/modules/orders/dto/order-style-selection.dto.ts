// src/dto/order-style-selection.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsMongoId,
  IsNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Represents a single selected option for a style field
 */
export class StyleFieldOptionSelectionDto {
  @ApiProperty({
    description: 'The field key (matches the key in Style.fields map)',
    example: 'collar_type',
  })
  @IsString()
  @IsNotEmpty()
  field_key: string;

  @ApiProperty({
    description: 'The ID of the selected option in the field',
    example: '507f1f77bcf86cd799439032',
  })
  @IsString()
  @IsNotEmpty()
  option_id: string;
}

/**
 * Represents a style selected in an order, including the chosen options
 */
export class OrderStyleSelectionDto {
  @ApiProperty({
    description: 'The ID of the style being selected',
    example: '507f1f77bcf86cd799439031',
  })
  @IsMongoId()
  style_id: string;

  @ApiProperty({
    description: 'Selected options for each field in the style',
    type: [StyleFieldOptionSelectionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StyleFieldOptionSelectionDto)
  options: StyleFieldOptionSelectionDto[];
}
