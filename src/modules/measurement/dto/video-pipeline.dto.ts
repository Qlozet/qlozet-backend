import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VideoPipelineSwaggerDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'Video file' })
  video: any;

  @ApiProperty({ description: 'Video title', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: 'User ID', required: false })
  @IsOptional()
  @IsString()
  userId?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  weight?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  height_cm?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  gender?: string;
}
