import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GenerateCodeDto {
  @ApiProperty({ description: 'Zoho authorization code returned from OAuth' })
  @IsString()
  @IsNotEmpty()
  code: string;
}
