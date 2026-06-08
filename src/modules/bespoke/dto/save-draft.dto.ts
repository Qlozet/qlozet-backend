import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsString,
  IsOptional,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class LineItemDto {
  @ApiPropertyOptional({ example: 'Base Tailoring' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}

export class SaveDraftDto {
  @ApiPropertyOptional({ type: [LineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  line_items?: LineItemDto[];

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  required_fabric_yards?: number;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  estimated_completion_days?: number;

  @ApiPropertyOptional({ example: 'Work in progress notes...' })
  @IsOptional()
  @IsString()
  vendor_notes?: string;
}
