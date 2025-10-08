import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsPhoneNumber,
  MinLength,
  Matches,
  IsOptional,
  IsUrl,
  IsArray,
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
  @IsNotEmpty({ message: 'Business name is required' })
  @MinLength(2, { message: 'Business name must be at least 2 characters long' })
  businessName: string;

  @ApiPropertyOptional({
    description: 'Business email address (optional)',
    example: 'business@fashionstore.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid business email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  businessEmail?: string;

  @ApiPropertyOptional({
    description: 'Business phone number (Nigerian format) (optional)',
    example: '+2348012345678',
  })
  @IsOptional()
  @IsPhoneNumber('NG', {
    message: 'Please provide a valid Nigerian business phone number',
  })
  businessPhoneNumber?: string;

  @ApiProperty({
    description: 'Business physical address',
    example: '123 Fashion Street, Lagos Island, Lagos',
  })
  @IsString()
  @IsNotEmpty({ message: 'Business address is required' })
  businessAddress: string;

  @ApiPropertyOptional({
    description: 'Website URL of the business (optional)',
    example: 'https://fashionstore.com',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Please provide a valid website URL' })
  websiteUrl?: string;

  // 👤 Personal Information
  @ApiProperty({
    description: 'Full name of the business owner or representative',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty({ message: 'Personal name is required' })
  personalName: string;

  @ApiProperty({
    description: 'Personal phone number (Nigerian format)',
    example: '+2348012345679',
  })
  @IsPhoneNumber('NG', {
    message: 'Please provide a valid Nigerian personal phone number',
  })
  @IsNotEmpty({ message: 'Personal phone number is required' })
  personalPhoneNumber: string;

  @ApiProperty({
    description: 'Personal email address of the business owner',
    example: 'john.doe@gmail.com',
  })
  @IsEmail({}, { message: 'Please provide a valid personal email address' })
  @IsNotEmpty({ message: 'Personal email is required' })
  @Transform(({ value }) => value.toLowerCase().trim())
  personalEmail: string;

  @ApiPropertyOptional({
    description: '11-digit National Identity Number (NIN) - Optional',
    example: '12345678901',
    pattern: '^\\d{11}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, {
    message: 'National identity number must be 11 digits',
  })
  nationalIdentityNumber?: string;

  // 🔐 Authentication
  @ApiProperty({
    description: 'Password (min 8 chars with uppercase, lowercase, and number)',
    example: 'SecurePassword123',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  // 🖼️ Media URLs (All Optional)
  @ApiPropertyOptional({
    description: 'Business logo image URL (optional)',
    example: 'https://cdn.qoobea.com/uploads/fashionstore/logo.png',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid logo URL' })
  businessLogoUrl?: string;

  @ApiPropertyOptional({
    description: 'Business cover image URL (optional)',
    example: 'https://cdn.qoobea.com/uploads/fashionstore/cover.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid cover image URL' })
  coverImageUrl?: string;

  @ApiPropertyOptional({
    description: 'Display picture URL for the vendor profile (optional)',
    example: 'https://cdn.qoobea.com/uploads/fashionstore/profile.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid display picture URL' })
  displayPictureUrl?: string;

  // 🧾 CAC or Business Documents (Optional)
  @ApiPropertyOptional({
    description:
      'List of URLs pointing to CAC or business registration documents (optional)',
    example: [
      'https://cdn.qoobea.com/uploads/fashionstore/cac_doc.pdf',
      'https://cdn.qoobea.com/uploads/fashionstore/tax_cert.pdf',
    ],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true, message: 'Each document URL must be valid' })
  cacDocumentUrl?: string[];
}
