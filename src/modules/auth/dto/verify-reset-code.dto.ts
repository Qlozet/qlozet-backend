import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';

export class VerifyResetCodeDto {
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
  // Exactly 6 digits — a wrong-length entry fails validation without spending
  // a lockout attempt.
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}
