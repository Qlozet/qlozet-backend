import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ReturnReason } from '../schemas/return.schema';

export class CreateReturnDto {
  @ApiProperty({ description: 'Order reference', example: 'QLOZ-ORD-1234567890' })
  @IsNotEmpty()
  @IsString()
  order_reference: string;

  @ApiProperty({ description: 'Business ID of the vendor' })
  @IsNotEmpty()
  @IsString()
  business_id: string;

  @ApiProperty({ description: 'Product IDs being returned', type: [String] })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  item_ids: string[];

  @ApiProperty({ enum: ReturnReason, description: 'Reason for return' })
  @IsNotEmpty()
  @IsEnum(ReturnReason)
  reason: ReturnReason;

  @ApiProperty({ description: 'Description of the issue', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Evidence image URLs', required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence_urls?: string[];
}
