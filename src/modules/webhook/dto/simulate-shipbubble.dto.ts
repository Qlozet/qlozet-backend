import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class SimulateShipbubbleDto {
  @ApiPropertyOptional({
    description: "Shipment's Shipbubble order id (stored as shipment_id).",
    example: 'SB-244512FE8276',
  })
  @IsOptional()
  @IsString()
  order_id?: string;

  @ApiPropertyOptional({
    description: "Shipment's tracking number (use this OR order_id).",
    example: 'DRY_RUN_1730000000000',
  })
  @IsOptional()
  @IsString()
  tracking_number?: string;

  @ApiProperty({
    description: 'Shipbubble status code to simulate.',
    example: 'in_transit',
    enum: [
      'pending',
      'confirmed',
      'picked_up',
      'in_transit',
      'out_for_delivery',
      'completed',
      'cancelled',
    ],
  })
  @IsString()
  @IsIn([
    'pending',
    'confirmed',
    'picked_up',
    'in_transit',
    'out_for_delivery',
    'completed',
    'cancelled',
  ])
  status: string;
}
