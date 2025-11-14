import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AvatarDto {
  @ApiProperty({
    description: 'Gender for avatar UI',
    enum: ['male', 'female'],
  })
  @IsString()
  ui_gender: string;
}
