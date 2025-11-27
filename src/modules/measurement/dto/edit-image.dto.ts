// src/designs/dto/edit-image.dto.ts

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class EditGarmentDto {
  @ApiPropertyOptional({
    description: 'URL of the base image',
    example: 'https://res.cloudinary.com/.../base.png',
  })
  @IsOptional()
  @IsString()
  base_image_url?: string;

  @ApiPropertyOptional({
    description: 'URL of the fabric image layer',
    example: 'https://res.cloudinary.com/.../fabric.png',
  })
  @IsOptional()
  @IsString()
  fabric_image_url?: string;

  @ApiPropertyOptional({
    description: 'URL of the accessory image layer',
    example: 'https://res.cloudinary.com/.../accessory.png',
  })
  @IsOptional()
  @IsString()
  accessory_image_url?: string;

  @ApiPropertyOptional({
    description: 'URL of the addon image layer',
    example: 'https://res.cloudinary.com/.../addon.png',
  })
  @IsOptional()
  @IsString()
  addon_image_url?: string;

  @ApiPropertyOptional({
    description: 'Type of garment being edited',
    example: "women's flare mini dress",
  })
  @IsOptional()
  @IsString()
  garment_type?: string;

  @ApiPropertyOptional({
    description: 'Base color of the garment',
    example: 'soft beige',
  })
  @IsOptional()
  @IsString()
  base_color?: string;

  @ApiPropertyOptional({
    description: 'Pattern applied to the garment',
    example: 'floral',
  })
  @IsOptional()
  @IsString()
  pattern?: string;

  @ApiPropertyOptional({
    description: 'Garment fit type',
    example: 'tailored',
  })
  @IsOptional()
  @IsString()
  fit?: string;

  @ApiPropertyOptional({
    description: 'Additional styling notes or instructions',
    example: 'Add slight texture and keep silhouette flowy',
  })
  @IsOptional()
  @IsString()
  style_notes?: string;
  @ApiPropertyOptional({
    description: 'Metadata JSON for the garment editor',
    example: {
      garment_type: "women's flare mini dress with matching headwrap",
      apply_to: 'dress_and_headwrap',
      parts: {
        neckline: {
          style: 'off_shoulder',
          variant: 'classic_band',
          height: 'just_below_shoulders',
          structure: 'smooth, clean, symmetrical',
        },
        sleeves: {
          style: 'puff',
          length: 'short',
          volume: 'moderate',
        },
      },
      notes: 'Keep dress length and flare as in base image.',
    },
  })
  metadata_json?: any;
  business?: string;
  customer?: string;
}
