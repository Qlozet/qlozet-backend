import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AvatarDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'Video file' })
  pred_json: any;
  @ApiProperty({
    description: 'Gender for avatar UI',
    enum: ['male', 'female'],
  })
  @IsString()
  ui_gender: string;
}
