import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsPhoneNumber,
  MinLength,
  Matches,
  IsOptional,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class VendorRegisterDto {
  // 🏢 Business Information
  @ApiProperty({
    description: 'Registered or legal business name',
    example: 'Fashion Store Ltd',
    minLength: 2,
  })
  @IsString()
  @IsNotEmpty({ message: 'business_name is required' })
  @MinLength(2, { message: 'business_name must be at least 2 characters long' })
  business_name: string;

  @ApiPropertyOptional({
    description: 'Business email address (optional)',
    example: 'business@fashionstore.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid business_email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  business_email?: string;

  @ApiPropertyOptional({
    description: 'Business phone number (optional)',
    example: '+2348012345678',
  })
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message: 'Please provide a valid business_phone_number',
  })
  business_phone_number?: string;

  @ApiPropertyOptional({
    description: 'Website URL of the business (optional)',
    example: 'https://fashionstore.com',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Please provide a valid website_url' })
  website_url?: string;

  // 👤 Personal Information
  @ApiProperty({
    description: 'Full name of the business owner or representative',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty({ message: 'personal_name is required' })
  personal_name: string;

  @ApiProperty({
    description: 'Personal phone number',
    example: '+2348012345679',
  })
  @IsPhoneNumber(undefined, {
    message: 'Please provide a valid personal_phone_number',
  })
  @IsNotEmpty({ message: 'personal_phone_number is required' })
  personal_phone_number: string;

  @ApiProperty({
    description: 'Personal email address of the business owner',
    example: 'john.doe@gmail.com',
  })
  @IsEmail({}, { message: 'Please provide a valid personal_email address' })
  @IsNotEmpty({ message: 'personal_email is required' })
  @Transform(({ value }) => value.toLowerCase().trim())
  personal_email: string;

  // national_identity_number is gone: it was accepted here and then never
  // persisted or used. Identity is established by QoreID verification
  // after signup, against a vNIN the vendor generates themselves.

  // 🔐 Authentication
  @ApiProperty({
    description: 'Password (min 8 chars with uppercase, lowercase, and number)',
    example: 'SecurePassword123',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'password is required' })
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  // 🖼️ Media URLs (All Optional)
  @ApiPropertyOptional({
    description: 'Business logo image URL (optional)',
    example: 'https://cdn.qoobea.com/uploads/fashionstore/logo.png',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid business_logo_url' })
  business_logo_url?: string;

  @ApiPropertyOptional({
    description: 'Business cover image URL (optional)',
    example: 'https://cdn.qoobea.com/uploads/fashionstore/cover.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid cover_image_url' })
  cover_image_url?: string;

  @ApiPropertyOptional({
    description: 'Display picture URL for the vendor profile (optional)',
    example: 'https://cdn.qoobea.com/uploads/fashionstore/profile.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid display_picture_url' })
  display_picture_url?: string;

  // No cac_document_url at registration. The CAC certificate is evidence
  // for verification, not signup data, and is filed through
  // POST /verification/business/cac/document once the vendor is in.
}
