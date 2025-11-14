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
    type: 'string',
    format: 'binary',
    description: 'Background image',
  })
  bg: any;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Front image' })
  front: any;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Side image' })
  side: any;

  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  notes?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  weight?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  height_cm?: string;
  @ApiProperty({ type: 'string', required: false, description: 'Notes' })
  gender?: string;
}
