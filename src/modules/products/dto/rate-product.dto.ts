// src/modules/product/dto/rate-product.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class RateProductDto {
  @ApiProperty({ example: 5, description: 'Rating value between 1 and 5' })
  @IsNumber()
  @Min(1)
  @Max(5)
  value: number;

  @ApiProperty({ example: 'Great quality and perfect fit', required: false })
  @IsOptional()
  @IsString()
  comment?: string;
}
