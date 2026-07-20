import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum DisputeResolution {
  FULL_REFUND = 'full_refund',
  PARTIAL_REFUND = 'partial_refund',
  RELEASE_TO_VENDOR = 'release_to_vendor',
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeResolution, description: 'How to resolve the dispute' })
  @IsNotEmpty()
  @IsEnum(DisputeResolution)
  resolution: DisputeResolution;

  @ApiProperty({ description: 'Refund amount (required for partial_refund)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  refund_amount?: number;

  @ApiProperty({ description: 'Admin notes explaining the resolution', required: false })
  @IsOptional()
  @IsString()
  admin_notes?: string;
}
