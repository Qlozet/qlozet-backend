import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: '67004f6bc39f85e42d3e8d91',
    description: 'User ID of the authenticated user',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    example: 'OldPassword123',
    description: 'Current password of the user',
  })
  @IsString()
  @Length(8, 64)
  currentPassword: string;

  @ApiProperty({
    example: 'NewSecurePassword123',
    description: 'New password for the user',
  })
  @IsString()
  @Length(8, 64)
  newPassword: string;
}
