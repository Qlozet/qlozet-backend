import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

/**
 * POST /measurements/silhouette-scan (multipart). The files are `front` and
 * `side`: PNG silhouettes (white person on black), cut out on the phone. No
 * photo or video is ever sent.
 */
export class SilhouetteScanDto {
  @ApiProperty({ example: 178, description: 'Height in cm' })
  @IsNumber()
  @Min(100)
  @Max(250)
  height_cm: number;

  @ApiPropertyOptional({ example: 75, description: 'Weight in kg' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(400)
  weight?: number;

  @ApiProperty({ enum: ['male', 'female'] })
  @IsString()
  @IsIn(['male', 'female'])
  gender: string;

  @ApiPropertyOptional({
    enum: ['scan', 'photo'],
    description: "'scan' = the live camera scan (video-scan price); 'photo' = the photo capture (photo-scan price).",
  })
  @IsOptional()
  @IsIn(['scan', 'photo'])
  kind?: 'scan' | 'photo';
}

/** What the queued job carries: the in-memory keys, never the images. */
export interface SilhouetteScanJob {
  front_token: string;
  side_token: string;
  height_cm: number;
  weight?: number;
  gender: string;
  kind: 'scan' | 'photo';
  business?: string;
  customer?: string;
}
