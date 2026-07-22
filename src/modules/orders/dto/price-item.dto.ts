import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderItemSelectionsDto } from './selection.dto';

/**
 * Price a single configured item authoritatively (same math the cart and order
 * use), so the product page can show the real price instead of a client-side
 * estimate. Returns the per-unit price.
 */
export class PriceItemDto {
  @ApiProperty({ example: '665abc123def456789012345' })
  @IsMongoId()
  product_id: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number = 1;

  @ApiPropertyOptional({ type: OrderItemSelectionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderItemSelectionsDto)
  selections?: OrderItemSelectionsDto;

  @ApiPropertyOptional({ description: 'External fabric product id (cross-vendor)' })
  @IsOptional()
  @IsMongoId()
  applied_fabric_id?: string;

  @ApiPropertyOptional({ description: 'Yards of the applied external fabric' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  applied_fabric_yards?: number;
}
