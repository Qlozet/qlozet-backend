import { Transform } from 'class-transformer';
import { PHONE_MESSAGE, phoneTransform } from '../../../common/utils/phone';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsPhoneNumber,
  IsEnum,
} from 'class-validator';

export class BaseRegistrationDto {
  @ApiProperty({ description: 'Full name of the customer' })
  @IsNotEmpty()
  @IsString()
  full_name: string;

  @ApiProperty({ description: 'Customer email' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Customer phone number' })
  @IsNotEmpty({ message: 'Enter your phone number.' })
  @Transform(phoneTransform)
  @IsPhoneNumber(undefined, { message: PHONE_MESSAGE })
  phone_number: string;

  @ApiProperty({ description: 'Customer password', minLength: 6 })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;
}
