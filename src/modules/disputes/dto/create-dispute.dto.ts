import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';
import { DisputeReason } from '../schemas/dispute.schema';

export class CreateDisputeDto {
  @ApiProperty({ description: 'Order reference', example: 'QLOZ-ORD-1234567890' })
  @IsNotEmpty()
  @IsString()
  order_reference: string;

  @ApiProperty({ description: 'Business ID of the vendor being disputed' })
  @IsNotEmpty()
  @IsString()
  business_id: string;

  @ApiProperty({ enum: DisputeReason, description: 'Reason for dispute' })
  @IsNotEmpty()
  @IsEnum(DisputeReason)
  reason: DisputeReason;

  @ApiProperty({ description: 'Detailed description of the issue' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'URLs to evidence images/videos', required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence_urls?: string[];
}
