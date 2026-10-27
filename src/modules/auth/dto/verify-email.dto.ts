import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    oneOf: [
      { example: '482193', description: '6-digit OTP for mobile verification' },
      {
        example: 'f3a1b2c4d5e6f7890abcdef123456789abcdef12',
        description: 'Long token for web email verification',
      },
    ],
    description: 'Verification token (6-digit OTP or long email token)',
  })
  @IsString()
  @Matches(/^(\d{6}|[A-Za-z0-9]{16,128})$/, {
    message: 'Token must be either a 6-digit OTP or a long alphanumeric token',
  })
  token: string;

  @ApiPropertyOptional({
    example: 'ada@example.com',
    description: 'The email the code was sent to. Required with a 6-digit code.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
