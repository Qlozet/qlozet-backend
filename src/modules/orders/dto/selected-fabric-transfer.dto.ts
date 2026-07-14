import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for selecting a fabric transfer shipping option at checkout.
 * This represents the Fabric Vendor → Tailor Vendor shipping leg.
 */
export class SelectedFabricTransferDto {
  @ApiProperty({
    description: 'Fabric vendor business ID (sender)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsNotEmpty()
  fabric_vendor_id: string;

  @ApiProperty({
    description: 'Tailor vendor business ID (receiver)',
    example: '507f1f77bcf86cd799439022',
  })
  @IsMongoId()
  @IsNotEmpty()
  tailor_vendor_id: string;

  @ApiProperty({
    description: 'The fabric product being transferred',
    example: '507f1f77bcf86cd799439033',
  })
  @IsMongoId()
  @IsNotEmpty()
  fabric_product_id: string;

  @ApiProperty({
    description: 'Yards of fabric being transferred',
    example: 3.5,
  })
  @IsNumber()
  fabric_yards: number;

  @ApiProperty({
    description: 'Shipbubble rate request token from checkout-preview',
    example: 'req_fabric_abc123',
  })
  @IsString()
  @IsNotEmpty()
  request_token: string;

  @ApiProperty({
    description: 'Selected courier ID',
    example: 'cour_456',
  })
  @IsString()
  @IsNotEmpty()
  courier_id: string;

  @ApiProperty({
    description: 'Courier service code',
    example: 'SB-STD',
  })
  @IsString()
  @IsNotEmpty()
  service_code: string;

  @ApiProperty({
    description: 'Courier display name',
    example: 'GIG Logistics',
  })
  @IsString()
  @IsNotEmpty()
  courier_name: string;

  @ApiProperty({
    description: 'Shipping fee for this fabric transfer',
    example: 1500,
  })
  @IsNumber()
  shipping_fee: number;
}
