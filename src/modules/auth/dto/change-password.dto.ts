import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123',
    description: 'Current password of the user',
  })
  @IsString()
  @Length(8, 64)
  current_password: string;

  @ApiProperty({
    example: 'NewSecurePassword123',
    description: 'New password for the user',
  })
  @IsString()
  @Length(8, 64)
  new_password: string;
}
