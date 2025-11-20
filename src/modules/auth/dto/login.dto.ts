import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';
import { BaseResponseDto } from '../../../common/dto/base-response.dto';

export class LoginDto {
  @ApiProperty({
    description: 'Email address used during registration',
    example: 'john.doe@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    description: 'Account password',
    example: 'SecurePassword123',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;
}

export class TokenDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MDQ5ZDQwOGFjNmYzNjJlNmNmMmNmNyIsImVtYWlsIjoiamlicmlsQGZpbmVjb3JlLmNvIiwiaWF0IjoxNzYzNjM1ODY0LCJleHAiOjE3NjQyNDA2NjR9.wbR7f9uyTYnlSuAdCs6f0J-bnkZTCYt4Z9fdMNQptR0',
  })
  access_token: string;

  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MDQ5ZDQwOGFjNmYzNjJlNmNmMmNmNyIsImVtYWlsIjoiamlicmlsQGZpbmVjb3JlLmNvIiwiaWF0IjoxNzYzNjM1ODY0LCJleHAiOjE3NjQyNDA2NjR9.8qt6VLkaD0VPnrgvxKt4jETuoNYhLWckPI6IoByY0V0',
  })
  refresh_token: string;
}

export class BaseUserDto {
  @ApiProperty({ example: '69049d408ac6f362e6cf2cf7' })
  _id: string;

  @ApiProperty({ example: 'John Doe' })
  full_name: string;

  @ApiProperty({ example: 'jibril@finecore.co' })
  email: string;

  @ApiProperty({ example: '+2348012345679' })
  phone_number: string;
  @ApiProperty({ example: true })
  email_verified: boolean;

  @ApiProperty({ example: '69049c4ec507748cf7dbecb3' })
  role: string;

  @ApiProperty({
    example:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQB2J8Tc056dMI-wNe0vmFtByW-ySbA3bY3nQ&s',
  })
  profile_picture: string;
  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ example: false })
  must_change_password: boolean;

  @ApiProperty({ type: [String], example: [] })
  wishlist: string[];

  @ApiProperty({ type: [String], example: [] })
  email_preferences: string[];

  @ApiProperty({
    example: '2025-10-31T11:28:00.560Z',
  })
  last_verification_email_sent: Date;

  @ApiProperty({ example: 0 })
  verification_email_attempts: number;

  @ApiProperty({ example: null })
  wears_preference: any;

  @ApiProperty({ type: [String], example: [] })
  aesthetic_preferences: string[];

  @ApiProperty({ type: [String], example: [] })
  body_fit: string[];

  @ApiProperty({ example: false })
  is_email_preference_selected: boolean;

  @ApiProperty({ example: '69049d408ac6f362e6cf2cfa' })
  business: string;

  @ApiProperty({ example: '2025-10-31T11:28:00.567Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-11-19T23:24:25.270Z' })
  updatedAt: Date;

  @ApiProperty({ example: '2025-10-31T11:31:43.600Z' })
  email_verified_at: Date;
}
export class VendorUserDto extends BaseUserDto {
  @ApiProperty({ example: 'vendor' })
  type: string;
}
export class CustomerUserDto extends BaseUserDto {
  @ApiProperty({ example: 'customer' })
  type: string;
}
export class LoginVendorResponseDto {
  @ApiProperty({ type: VendorUserDto })
  user: VendorUserDto;

  @ApiProperty({ type: TokenDto })
  token: TokenDto;
}
export class LoginCustomerResponseDto {
  @ApiProperty({ type: CustomerUserDto })
  user: CustomerUserDto;

  @ApiProperty({ type: TokenDto })
  token: TokenDto;
}

export class LoginVendorResponseWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: LoginVendorResponseDto })
  data: LoginVendorResponseDto;
}
export class LoginCustomerResponseWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: LoginVendorResponseDto })
  data: LoginVendorResponseDto;
}
