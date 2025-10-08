import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class PasswordResetDto {
  @ApiProperty({
    example: 'e1a9b2f4c8d0e6f3a7b9c5d1e2f8a0b3',
    description: 'Password reset token received via email',
  })
  @IsString()
  @Length(10, 128)
  token: string;

  @ApiProperty({
    example: 'NewSecurePassword123',
    description: 'New password for the user account',
  })
  @IsString()
  @Length(8, 64)
  newPassword: string;
}
