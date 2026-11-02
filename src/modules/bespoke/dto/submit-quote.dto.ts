import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsString,
  IsOptional,
  IsIn,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EXTRA_FABRIC_ROLES, type ExtraFabricRole } from '../quote-fabric';

export class ExtraFabricYardsDto {
  @ApiProperty({ enum: EXTRA_FABRIC_ROLES })
  @IsIn(EXTRA_FABRIC_ROLES)
  role: ExtraFabricRole;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0.1)
  yards: number;
}

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

  @ApiPropertyOptional({
    example: 7,
    description:
      'Yards of fabric required. Required when the design has a fabric (it prices the fabric); optional when the tailor sources the fabric and types its cost on the "Fabric" line.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  required_fabric_yards?: number;

  @ApiPropertyOptional({
    type: [ExtraFabricYardsDto],
    description: "Yards for each of the design's extra fabrics (contrast, lining). Required for each one picked from a listing.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraFabricYardsDto)
  extra_fabric_yards?: ExtraFabricYardsDto[];

  @ApiProperty({ example: 14, description: 'Days the tailor needs before shipping, counted from payment. This is the ship-by deadline late penalties are measured against; delivery time is on top.' })
  @IsNumber()
  @Min(1)
  estimated_completion_days: number;

  @ApiPropertyOptional({ example: 'Custom orders become non-cancellable after cutting begins.' })
  @IsOptional()
  @IsString()
  vendor_notes?: string;
}
