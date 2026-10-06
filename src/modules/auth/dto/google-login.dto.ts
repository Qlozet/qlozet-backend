import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      "The ID token Google returns to the browser. Verified server-side " +
      'against our client id - never decoded and trusted as-is.',
  })
  @IsNotEmpty()
  @IsString()
  id_token: string;
}
