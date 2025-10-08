// dto/inventory-update.dto.ts
import {
  IsNumber,
  Min,
  IsOptional,
  IsArray,
  ValidateNested,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SizeQuantityDto {
  @ApiProperty()
  @IsString()
  size: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  quantity: number;
}

export class InventoryUpdateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeQuantityDto)
  sizeOptions?: SizeQuantityDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  restockThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockAlert?: number;
}
