import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateTicketDto {
  @ApiProperty({
    example: 'John',
    description: 'The first name of the user',
  })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({
    example: 'Doe',
    description: 'The last name of the user',
  })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'The email address of the user',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'I need help with my account.',
    description: 'The message or description of the ticket',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Message must be at least 10 characters long' })
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters' })
  message: string;

  @ApiProperty({
    example: 'Account Issue',
    description: 'The subject of the ticket',
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    example: '+2348065678901',
    description: 'The phone number of the user',
  })
  @IsPhoneNumber(undefined, { message: 'Invalid phone number' })
  @IsNotEmpty()
  phone_number: string;
}
