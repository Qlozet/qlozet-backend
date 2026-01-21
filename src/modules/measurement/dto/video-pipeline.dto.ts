import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VideoPipelineSwaggerDto {
  @ApiProperty({ type: 'string', format: 'url', description: 'Video file url' })
  @IsNotEmpty()
  @IsString()
  video_url: string;

  @ApiProperty({ description: 'Video title' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'Weight value' })
  @IsOptional()
  @IsString()
  weight: string;

  @ApiProperty({ description: 'Height in cm' })
  @IsNotEmpty()
  @IsString()
  height_cm: string;

  @ApiProperty({ description: 'Gender value' })
  @IsNotEmpty()
  @IsString()
  gender?: string;

  business?: string;
  customer?: string;

  @ApiProperty({ description: 'Processing method', example: 'mp' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: 'mp_t value', example: 0.12 })
  @IsOptional()
  @IsNumber()
  mp_t?: number;

  @ApiPropertyOptional({
    description: 'Whether back view is wanted',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  want_back?: boolean;

  @ApiPropertyOptional({ description: 'Flag to generate mesh', default: false })
  @IsOptional()
  @IsBoolean()
  want_mesh_flag?: boolean;
}
