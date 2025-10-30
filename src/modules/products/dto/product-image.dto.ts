import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class StyleHotspotDto {
  @IsString()
  image_id: string;

  @ApiProperty({ example: 'collar_style', description: 'Target field key' })
  @IsString()
  field_key: string;

  @ApiPropertyOptional({
    example: 'Classic Collar',
    description: 'Display label',
  })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ example: 0.45, description: 'X coordinate (0–1)' })
  @IsNumber()
  @Min(0)
  x: number;

  @ApiProperty({ example: 0.1, description: 'Y coordinate (0–1)' })
  @IsNumber()
  @Min(0)
  y: number;

  @ApiPropertyOptional({
    example: 'center',
    enum: ['center', 'top-left'],
    description: 'Anchor position for hotspot',
  })
  @IsOptional()
  @IsString()
  anchor?: 'center' | 'top-left';

  @ApiPropertyOptional({
    example: 12,
    description: 'Radius of the hotspot in px',
  })
  @IsOptional()
  @IsNumber()
  radius?: number;

  @ApiPropertyOptional({ example: 1, description: 'Draw order (z-index)' })
  @IsOptional()
  @IsNumber()
  zIndex?: number;
}

export class ProductImageDto {
  @ApiProperty({
    example: 'qlozet/products/denim-jacket-1',
    description: 'Cloudinary public ID',
  })
  @IsString()
  public_id: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/qlozet/image/upload/v1/products/denim-jacket-1.jpg',
    description: 'Image URL',
  })
  @IsString()
  url: string;

  @ApiPropertyOptional({ example: 1200, description: 'Image width' })
  @IsOptional()
  @IsNumber()
  width?: number;

  @ApiPropertyOptional({ example: 1600, description: 'Image height' })
  @IsOptional()
  @IsNumber()
  height?: number;

  @ApiPropertyOptional({
    type: [StyleHotspotDto],
    description: 'List of style hotspots within the image',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StyleHotspotDto)
  hotspots?: StyleHotspotDto[];
}
