import { Transform } from 'class-transformer';
import { PHONE_MESSAGE, phoneTransform } from '../../../common/utils/phone';
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
  @Transform(phoneTransform)
  @IsPhoneNumber(undefined, { message: PHONE_MESSAGE })
  phone_number?: string;
}

/** A signed-in store account opening a store of its own. */
export class NewStoreDto {
  @ApiProperty({ example: 'Ada Couture' })
  @IsString()
  @MinLength(2, { message: 'Enter your store name (at least 2 characters).' })
  business_name: string;

  @ApiPropertyOptional({
    description: 'Only used when the login has no phone number yet.',
    example: '+2348031234567',
  })
  @IsOptional()
  @Transform(phoneTransform)
  @IsPhoneNumber(undefined, { message: PHONE_MESSAGE })
  phone_number?: string;
}
