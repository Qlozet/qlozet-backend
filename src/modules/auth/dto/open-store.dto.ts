import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

/** A signed-in shopper opening a store on the same email (linked-accounts.ts). */
export class OpenStoreDto {
  @ApiProperty({ example: 'Ada Couture' })
  @IsString()
  @MinLength(2, { message: 'Enter your store name (at least 2 characters).' })
  business_name: string;

  @ApiPropertyOptional({
    description:
      'Only for shoppers who signed up with Google and have no password yet: the password for the store.',
  })
  @IsOptional()
  @IsString()
  @Length(8, 64)
  password?: string;

  @ApiPropertyOptional({
    description: "The store's phone number; defaults to the shop account's.",
    example: '+2348031234567',
  })
  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'Enter a valid phone number.' })
  phone_number?: string;
}
