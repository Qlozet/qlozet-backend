import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from './social-links.dto';

export class UpdateBusinessProfileDto {
  @ApiPropertyOptional({ example: 'Qlozet Fashion House' })
  @IsOptional()
  @IsString()
  business_name?: string;

  @ApiPropertyOptional({ example: 'contact@qlozet.com' })
  @IsOptional()
  @IsString()
  business_email?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  business_phone_number?: string;

  @ApiPropertyOptional({ example: 'https://www.qlozet.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: 'Premium African fashion brand specializing in bespoke designs.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2020' })
  @IsOptional()
  @IsString()
  year_founded?: string;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/logos/business-logo.png' })
  @IsOptional()
  @IsString()
  business_logo_url?: string;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/logos/business-logo.svg' })
  @IsOptional()
  @IsString()
  business_logo_svg_url?: string;

  @ApiPropertyOptional({ example: 'https://cdn.qlozet.com/covers/storefront.jpg' })
  @IsOptional()
  @IsString()
  cover_image_url?: string;

  @ApiPropertyOptional({
    example: '#8D7F72',
    description: 'Storefront accent color (hex)',
  })
  @IsOptional()
  @IsString()
  theme_color?: string;

  @ApiPropertyOptional({
    type: SocialLinksDto,
    example: {
      instagram: 'kemicouture',
      twitter: 'kemicouture',
      pinterest: null,
      youtube: null,
      tiktok: null,
    },
    description:
      'Vendor social handles. Stored as handles, not URLs - a pasted profile ' +
      'URL is reduced to its handle, and the link is built by the clients.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  social_links?: SocialLinksDto;

  // cac_document_url is not settable here. The CAC certificate is evidence
  // for verification, not a profile asset, and it now arrives only through
  // POST /verification/business/cac/document - one way in, beside the RC
  // number check it supports, rather than through a general profile update
  // that also carries the logo.

  // nin / bvn deliberately absent - see the note in business.schema.ts.

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to accept fabric from other vendors for bespoke orders',
  })
  @IsOptional()
  @IsBoolean()
  accepts_external_fabric?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this vendor takes bespoke / made-to-measure work',
  })
  @IsOptional()
  @IsBoolean()
  accepts_bespoke?: boolean;

  // ─── Vendor order preferences ───
  @ApiPropertyOptional({ example: false, description: 'Auto-confirm incoming orders' })
  @IsOptional()
  @IsBoolean()
  order_confirmation?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Notify on order status changes' })
  @IsOptional()
  @IsBoolean()
  order_notifications?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Customer-facing order tracking' })
  @IsOptional()
  @IsBoolean()
  order_tracking?: boolean;

  @ApiPropertyOptional({ example: 0, description: 'Max orders accepted per day (0 = no limit)' })
  @IsOptional()
  @IsNumber()
  daily_order_limit?: number;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Maximum orders this vendor can have in flight at once (0 = unlimited).',
  })
  @IsOptional()
  @IsNumber()
  max_open_orders?: number;

  @ApiPropertyOptional({ example: false, description: 'Auto-process refunds on returns' })
  @IsOptional()
  @IsBoolean()
  automatic_refunds?: boolean;

  @ApiPropertyOptional({ example: 14, description: 'Return window in days (0 | 7 | 14 | 30 | 60)' })
  @IsOptional()
  @IsNumber()
  @IsIn([0, 7, 14, 30, 60])
  return_window_days?: number;

  @ApiPropertyOptional({ example: true, description: 'Allow add-ons / customisation on orders' })
  @IsOptional()
  @IsBoolean()
  custom_order_options?: boolean;

  @ApiPropertyOptional({ example: 'NGN', description: 'Default currency (NGN | USD | GBP | EUR)' })
  @IsOptional()
  @IsString()
  @IsIn(['NGN', 'USD', 'GBP', 'EUR'])
  default_currency?: string;
}
