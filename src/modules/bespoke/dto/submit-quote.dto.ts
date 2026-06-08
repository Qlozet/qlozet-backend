import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsString,
  IsOptional,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class LineItemDto {
  @ApiProperty({ example: 'Base Tailoring' })
  @IsString()
  label: string;

  @ApiProperty({ example: 25000 })
  @IsNumber()
  @Min(0)
  amount: number;
}

export class SubmitQuoteDto {
  @ApiProperty({ type: [LineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  @ArrayMinSize(1)
  line_items: LineItemDto[];

  @ApiProperty({ example: 7, description: 'Yards of fabric required' })
  @IsNumber()
  @Min(0.1)
  required_fabric_yards: number;

  @ApiProperty({ example: 14, description: 'Days from acceptance to delivery' })
  @IsNumber()
  @Min(1)
  estimated_completion_days: number;

  @ApiPropertyOptional({ example: 'Custom orders become non-cancellable after cutting begins.' })
  @IsOptional()
  @IsString()
  vendor_notes?: string;
}
