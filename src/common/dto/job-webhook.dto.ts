import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';

export class JobWebhookDto {
  @ApiProperty({ example: 'f2a8c73b-092a-4c18-9df7-8c2e8b45a3f1' })
  @IsString()
  jobId: string;

  @ApiProperty({
    example: 'completed',
    description: 'Job state (completed, failed, active, waiting, etc.)',
  })
  @IsString()
  status: string;

  @ApiProperty({
    required: false,
    example: { url: 'https://image.com/output.png' },
  })
  @IsOptional()
  @IsObject()
  data?: any;

  @ApiProperty({ required: false, example: 'Processing failed due to timeout' })
  @IsOptional()
  @IsString()
  error?: string;
}
