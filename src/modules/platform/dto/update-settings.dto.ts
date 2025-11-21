import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({
    description: 'Payout cycle for vendors',
    enum: ['weekly', 'bi-weekly', 'monthly'],
    example: 'weekly',
  })
  payout_cycle?: string;

  @ApiPropertyOptional({
    description: 'Minimum payout threshold before payout can occur',
    example: 2000,
  })
  minimum_payout?: number;

  @ApiPropertyOptional({
    description:
      'Number of days after order completion before payout becomes eligible',
    example: 7,
  })
  payout_delay_days?: number;

  @ApiPropertyOptional({
    description: 'Percentage of upfront payment for tailored orders',
    example: 50,
  })
  tailored_order_upfront?: number;

  @ApiPropertyOptional({
    description: 'Commission percentage deducted by the platform',
    example: 10,
  })
  platform_commission_percent?: number;

  @ApiPropertyOptional({
    description:
      'Percentage handling fee deducted to cover payment gateway charges',
    example: 1.5,
  })
  payment_handling_fee_percent?: number;

  @ApiPropertyOptional({
    description: 'Flat charge for handling fee (e.g., ₦100)',
    example: 100,
  })
  payment_handling_fee_flat?: number;
}
