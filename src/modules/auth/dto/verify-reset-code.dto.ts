import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

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
  @Length(4, 8)
  code: string;
}
