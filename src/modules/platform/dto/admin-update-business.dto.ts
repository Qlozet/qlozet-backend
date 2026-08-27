import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator';

/**
 * Fields an admin may edit on someone else's business.
 *
 * Deliberately a allowlist rather than a passthrough. `updateBusinessProfile`
 * takes `any` and `$set`s it, so an unconstrained body would let this route
 * write `status` (which has its own approve/verify/reject endpoints and an
 * audit trail through them), `earnings`, `payout_history`,
 * `pending_payout_balance` or `transfer_recipient_code` — money and lifecycle
 * fields that must never move because someone edited a profile form.
 *
 * Payout account fields are included: they are what the console's Bank Details
 * card shows, and correcting a mistyped account number is exactly the sort of
 * support task an admin is asked to do. They are NOT the same as initiating a
 * payout, which remains out of reach here.
 */
export class AdminUpdateBusinessDto {
  @ApiPropertyOptional({ example: 'Fashion Store Ltd' })
  @IsOptional()
  @IsString()
  business_name?: string;

  @ApiPropertyOptional({ example: 'store@example.com' })
  @IsOptional()
  @IsString()
  business_email?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  business_phone_number?: string;

  @ApiPropertyOptional({ example: 'We tailor bespoke agbada.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://www.qlozet.app' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: '2023' })
  @IsOptional()
  @IsString()
  year_founded?: string;

  // ---- Imagery. The console's banner and avatar read these two. ----
  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../logo.png',
    description:
      'Uploaded via the existing Cloudinary upload endpoint; this stores the resulting URL.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  business_logo_url?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/.../cover.jpg' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  cover_image_url?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/.../logo.svg' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  business_logo_svg_url?: string;

  // ---- Compliance documents ----
  // The console shows these on the vendor's verification cards. Without them
  // on this allowlist an admin could view a CAC certificate but never attach
  // one, so a vendor who emailed their document in had no route onto the record.
  @ApiPropertyOptional({
    example: ['https://res.cloudinary.com/.../cac.pdf'],
    description: 'Replaces the stored list of CAC document URLs.',
  })
  @IsOptional()
  @IsArray()
  @IsUrl({ require_tld: false }, { each: true })
  cac_document_url?: string[];

  // ---- Address ----
  @ApiPropertyOptional({ example: '1161 M. Dr, Wuse, Abuja' })
  @IsOptional()
  @IsString()
  business_address?: string;

  @ApiPropertyOptional({ example: 'Abuja' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Federal Capital Territory' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'Nigeria' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '900101' })
  @IsOptional()
  @IsString()
  zip_code?: string;

  // ---- Payout account (what the Bank Details card displays) ----
  @ApiPropertyOptional({ example: 'Access Bank' })
  @IsOptional()
  @IsString()
  payout_bank_name?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @IsString()
  payout_account_number?: string;

  @ApiPropertyOptional({ example: 'Fashion Store Ltd' })
  @IsOptional()
  @IsString()
  payout_account_name?: string;
}
