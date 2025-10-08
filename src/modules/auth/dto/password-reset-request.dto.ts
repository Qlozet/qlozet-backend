import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class PasswordResetRequestDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to send password reset link',
  })
  @IsEmail()
  email: string;
}
