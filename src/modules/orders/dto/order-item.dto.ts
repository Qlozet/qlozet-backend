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

  @ApiPropertyOptional({ description: 'Quantity of the item (if no variant is selected)' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @ApiProperty({
    type: OrderItemSelectionsDto,
    description: 'Selections for the product',
  })
  @ValidateNested()
  @Type(() => OrderItemSelectionsDto)
  selections: OrderItemSelectionsDto;

  @ApiPropertyOptional({
    description:
      "Product id of a fabric the customer supplies from another vendor (external/'use my own fabric'). Carried onto the order item so the tailor can see it.",
    type: String,
  })
  @IsMongoId()
  @IsOptional()
  applied_fabric_id?: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Yards of the applied external fabric.',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  applied_fabric_yards?: number;
}
