import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsString,
  IsOptional,
  IsIn,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExtraFabricYardsDto {
  @ApiProperty({ enum: ['contrast', 'lining'] })
  @IsIn(['contrast', 'lining'])
  role: 'contrast' | 'lining';

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0.1)
  yards: number;
}

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

  @ApiPropertyOptional({
    type: [ExtraFabricYardsDto],
    description: "Yards for each of the design's extra fabrics (contrast, lining). Required for each one picked from a listing.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraFabricYardsDto)
  extra_fabric_yards?: ExtraFabricYardsDto[];

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
