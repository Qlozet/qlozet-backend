import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AutoMaskPredictBodyDto {
  @ApiProperty({ description: 'Background removal flag', required: false })
  @IsOptional()
  @IsString()
  bgRemoval?: string;

  @ApiProperty({ description: 'Any user notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
export class AutoMaskSwaggerDto {
  @ApiProperty({
    type: String,
    description: 'URL of the background image',
    example: 'https://example.com/image-bg.jpg',
  })
  bg: string;

  @ApiProperty({
    type: String,
    description: 'URL of the front image',
    example: 'https://example.com/image-front.jpg',
  })
  front: string;

  @ApiProperty({
    type: String,
    description: 'URL of the side image',
    example: 'https://example.com/image-side.jpg',
  })
  side: string;

  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  notes?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  weight?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  height_cm?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  gender?: string;
  business?: string;
  customer?: string;
}
