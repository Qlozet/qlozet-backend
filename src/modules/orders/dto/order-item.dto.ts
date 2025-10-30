// src/dto/order-item.dto.ts
import { Types } from 'mongoose';
import {
  IsMongoId,
  IsNumber,
  Min,
  ValidateNested,
  IsOptional,
  IsString,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderItemSelectionsDto } from './selection.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProcessedOrderItemDto {
  @ApiProperty({ description: 'Product ID', type: String })
  @IsMongoId()
  product_id: Types.ObjectId;

  @ApiPropertyOptional({ description: 'Note for this order item' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({
    type: OrderItemSelectionsDto,
    description: 'Selections for the product',
  })
  @ValidateNested()
  @Type(() => OrderItemSelectionsDto)
  selections: OrderItemSelectionsDto;
}
