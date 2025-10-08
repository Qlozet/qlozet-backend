import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: 'f3a1b2c4d5e6f7890abcdef123456789',
    description: 'Email verification token sent to user email',
  })
  @IsString()
  @Length(10, 128)
  token: string;
}
