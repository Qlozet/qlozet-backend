import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// One side of the token price (USD base / NGN derived).
class TokenCurrencyDto {
  @ApiPropertyOptional({ description: 'Price amount', example: 0.01 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;
}

class TokenPriceDto {
  @ApiPropertyOptional({ type: TokenCurrencyDto, description: 'USD base price' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TokenCurrencyDto)
  usd?: TokenCurrencyDto;

  @ApiPropertyOptional({
    type: TokenCurrencyDto,
    description: 'NGN price (normally derived from USD via the FX refresh)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TokenCurrencyDto)
  ngn?: TokenCurrencyDto;
}

/**
 * Update the platform settings singleton. Every field is optional — send only
 * what changes. Used with `whitelist: true` on the route, so unknown keys are
 * stripped rather than silently persisted.
 */
export class UpdatePlatformSettingsDto {
  // ── Payouts & earnings ──
  @ApiPropertyOptional({
    description: 'Payout cycle for vendors',
    enum: ['weekly', 'bi-weekly', 'monthly'],
    example: 'weekly',
  })
  @IsOptional()
  @IsIn(['weekly', 'bi-weekly', 'monthly'])
  payout_cycle?: string;

  @ApiPropertyOptional({
    description: 'Minimum balance (₦) before a payout can run',
    example: 2000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimum_payout?: number;

  @ApiPropertyOptional({
    description: 'Days after completion before earnings become payout-eligible',
    example: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  payout_delay_days?: number;

  @ApiPropertyOptional({
    description:
      'Safety-net: auto-release completion earnings this many days after dispatch',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  auto_release_days?: number;

  @ApiPropertyOptional({
    description:
      'Milestone upfront % for custom/tailored orders (rest on delivery)',
    example: 65,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tailored_order_upfront_percent?: number;

  @ApiPropertyOptional({
    description: 'Fabric reservation fee (%)',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  reservation_fee_percent?: number;

  // ── Commission, fees & tax ──
  @ApiPropertyOptional({
    description: 'Commission percentage deducted by the platform',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  platform_commission_percent?: number;

  @ApiPropertyOptional({
    description: 'Whether commission is a percentage or a flat ₦ amount',
    enum: ['percent', 'fixed'],
    example: 'percent',
  })
  @IsOptional()
  @IsIn(['percent', 'fixed'])
  platform_commission_type?: 'percent' | 'fixed';

  @ApiPropertyOptional({
    description: 'Flat commission (₦) when the type is "fixed"',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  platform_commission_flat?: number;

  @ApiPropertyOptional({
    description: 'Percentage handling fee (payment gateway charges)',
    example: 1.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  payment_handling_fee_percent?: number;

  @ApiPropertyOptional({
    description: 'Flat handling fee (e.g. ₦100)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  payment_handling_fee_flat?: number;

  @ApiPropertyOptional({
    description: 'Tax applied to the order total (%)',
    example: 0.75,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tax_percent?: number;

  // ── Order lifecycle timers ──
  @ApiPropertyOptional({
    description: 'Return eligibility window from delivery (days)',
    example: 7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  return_window_days?: number;

  @ApiPropertyOptional({
    description: 'Auto-reject orders a vendor never confirms after N hours',
    example: 24,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  auto_reject_hours?: number;

  @ApiPropertyOptional({
    description: 'Late-fulfilment penalty accrual per day (%)',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  late_penalty_percent_per_day?: number;

  @ApiPropertyOptional({
    description: 'Cap on the late-fulfilment penalty (%)',
    example: 25,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  late_penalty_max_percent?: number;

  // ── Inventory thresholds ──
  @ApiPropertyOptional({
    description: 'Units at/under which a variant is flagged "low stock"',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_stock_threshold?: number;

  @ApiPropertyOptional({
    description: 'Yards under which fabric is "low" (0 → 2× the fabric min_cut)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_fabric_yards?: number;

  // ── AI / token pricing (cost per feature, in tokens) ──
  @ApiPropertyOptional({ description: 'Image measurement cost (tokens)', example: 25 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  image_measurement_token_price?: number;

  @ApiPropertyOptional({ description: 'Video measurement cost (tokens)', example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  video_measurement_token_price?: number;

  @ApiPropertyOptional({ description: 'Outfit generation cost (tokens)', example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  outfit_generation_token_price?: number;

  @ApiPropertyOptional({ description: 'Edit garment cost (tokens)', example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  edit_garment_token_price?: number;

  @ApiPropertyOptional({ description: 'Run prediction cost (tokens)', example: 45 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  run_prediction_token_price?: number;

  @ApiPropertyOptional({ description: 'AI-ask cost (tokens)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ai_ask_token_price?: number;

  @ApiPropertyOptional({ description: 'Analyze reference cost (tokens)', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  analyze_reference_token_price?: number;

  @ApiPropertyOptional({
    description: 'Require auth for the AI-ask feature',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  ai_ask_requires_auth?: boolean;

  // ── Token price (FX) ──
  @ApiPropertyOptional({
    type: TokenPriceDto,
    description:
      'Token price. Set usd.amount; ngn is normally derived via the FX refresh.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TokenPriceDto)
  token_price?: TokenPriceDto;

  // ── Multi-currency ──
  @ApiPropertyOptional({
    description: 'Group/consolidation currency for platform revenue',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  base_currency?: string;

  @ApiPropertyOptional({
    description: 'Currencies customers can browse/pay in',
    example: ['NGN', 'USD'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supported_currencies?: string[];

  @ApiPropertyOptional({
    description: 'FX spread over mid-market applied at checkout (%)',
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  fx_markup_percent?: number;

  @ApiPropertyOptional({
    description:
      "Processor per charge currency; 'default' covers the rest",
    example: { NGN: 'paystack', default: 'stripe' },
  })
  @IsOptional()
  @IsObject()
  currency_processor_map?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Enable Stripe charging (kill-switch for non-NGN payments)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  stripe_enabled?: boolean;
}
