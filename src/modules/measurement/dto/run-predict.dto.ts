import { ApiBody, ApiConsumes, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsNumber, IsString } from 'class-validator';

export class RunPredictBodyDto {
  @ApiProperty({ description: 'User height in cm', required: false })
  @IsOptional()
  @IsNumber()
  height_cm?: number;

  @ApiProperty({ description: 'User weight in kg', required: false })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiProperty({
    description: 'Gender',
    enum: ['male', 'female'],
    example: 'female',
  })
  gender: 'male' | 'female';

  @ApiProperty({ description: 'Additional notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
  business?: string;
  customer?: string;
}

export class RunPredictSwaggerDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'Front image' })
  front_image: any;

  @ApiProperty({ type: 'string', format: 'binary', description: 'Side image' })
  side_image: any;

  @ApiProperty({ type: RunPredictBodyDto })
  body: RunPredictBodyDto;
}
