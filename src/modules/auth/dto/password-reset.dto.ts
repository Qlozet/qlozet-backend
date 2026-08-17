import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class PasswordResetDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email the reset code was sent to',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '482913',
    description: '6-digit reset code received via email',
  })
  @IsString()
  // Exactly 6 digits: a wrong-length entry is a validation error, so a typo
  // never reaches the code check and never spends a lockout attempt.
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;

  @ApiProperty({
    example: 'NewSecurePassword123',
    description: 'New password for the user account',
  })
  @IsString()
  @Length(8, 64)
  newPassword: string;
}
