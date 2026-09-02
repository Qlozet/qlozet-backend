import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ClaimCourierSelectionDto {
  @ApiProperty({ description: 'request_token from the claim shipping preview' })
  @IsNotEmpty()
  @IsString()
  request_token: string;

  @ApiProperty({ description: 'Chosen courier id from the quoted rates' })
  @IsNotEmpty()
  @IsString()
  courier_id: string;

  @ApiProperty({ description: 'Chosen courier service code' })
  @IsNotEmpty()
  @IsString()
  service_code: string;
}

export class ClaimReservationDto {
  @ApiProperty({
    description: 'Number of yards to claim from the reservation',
    example: 5,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.1)
  yards: number;

  @ApiPropertyOptional({
    description:
      'Delivery address id — omit for event pickup (organizer hands over the yards)',
  })
  @IsOptional()
  @IsString()
  address_id?: string;

  @ApiPropertyOptional({
    description:
      'Courier selection from POST /reservations/:id/claim-preview — omit for event pickup',
    type: ClaimCourierSelectionDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClaimCourierSelectionDto)
  courier?: ClaimCourierSelectionDto;

  @ApiPropertyOptional({
    description:
      'Charge currency — non-NGN routes to Stripe when available (falls back to ₦/Paystack).',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class ClaimShippingPreviewDto {
  @ApiProperty({ description: 'Yards the guest intends to claim', example: 6 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.1)
  yards: number;

  @ApiPropertyOptional({
    description: 'Delivery address id (defaults to the default address)',
  })
  @IsOptional()
  @IsString()
  address_id?: string;
}
