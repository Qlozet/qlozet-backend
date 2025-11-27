import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ConstructionSelection = Record<
  string,
  string | boolean | undefined
>;

export class MeasurementProfileDto {
  @ApiPropertyOptional({ description: 'Height in centimeters', example: 170 })
  heightCm?: number;

  @ApiPropertyOptional({
    description: 'Body shape description',
    example: 'Pear shaped',
  })
  bodyShape?: string;

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Broad shoulders',
  })
  keyNotes?: string;
}

export class GarmentConfigDto {
  @ApiProperty({
    description: 'Type of garment',
    enum: [
      'male_kaftan',
      'male_agbada',
      'dress',
      'jumpsuit',
      'trousers',
      'skirt',
      'suit',
      'male_shirt',
      'female_shirt',
      'female_kaftan',
    ],
    example: 'dress',
  })
  garmentType: string;

  @ApiProperty({
    description: 'Gender',
    enum: ['male', 'female', 'unisex'],
    example: 'female',
  })
  gender: 'male' | 'female' | 'unisex';

  @ApiProperty({
    description: 'View of the garment',
    enum: ['front', 'back', 'side'],
    example: 'front',
  })
  view: 'front' | 'back' | 'side';

  @ApiPropertyOptional({
    description: 'Occasion for the garment',
    example: 'wedding',
  })
  occasion?: string;

  @ApiPropertyOptional({
    description: 'Aesthetic keywords',
    type: [String],
    example: ['elegant', 'modern'],
  })
  aestheticKeywords?: string[];

  @ApiPropertyOptional({
    description: 'Fit of the garment',
    enum: ['slim', 'tailored', 'regular', 'relaxed', 'oversized'],
    example: 'tailored',
  })
  fit?: 'slim' | 'tailored' | 'regular' | 'relaxed' | 'oversized';

  @ApiPropertyOptional({
    description: 'Fit notes',
    example: 'Slightly loose at waist',
  })
  fitNotes?: string;

  @ApiPropertyOptional({
    description: 'Fabric reference ID or URL',
    example: 'fabric_12345',
  })
  fabricRefId?: string;

  @ApiPropertyOptional({
    description: 'Embroidery reference ID or URL',
    example: 'embro_98765',
  })
  embroideryRefId?: string;

  @ApiPropertyOptional({
    description: 'Whether embroidery is strict',
    example: true,
  })
  hasStrictEmbroidery?: boolean;

  @ApiPropertyOptional({ type: MeasurementProfileDto })
  measurementProfile?: MeasurementProfileDto;

  @ApiPropertyOptional({
    description: 'Raw construction selections from UI',
    example: { neckline: 'V-neck', sleeve_style: 'short sleeve' },
  })
  constructionSelections?: ConstructionSelection;

  @ApiPropertyOptional({
    description: 'Inspiration images URLs',
    type: [String],
    example: [
      'https://example.com/image1.jpg',
      'https://example.com/image2.jpg',
    ],
  })
  inspirationImageUrls?: string[];

  @ApiPropertyOptional({
    description: 'Silhouette image URL',
    format: 'url',
    example: 'https://example.com/silhouette.jpg',
  })
  silhouetteImageUrl?: string;
}

export class GenerateOutfitRequestDto {
  @ApiProperty({ type: GarmentConfigDto })
  config: GarmentConfigDto;

  @ApiPropertyOptional({
    description: 'Optional user prompt for design',
    example: 'Make it elegant and modern',
  })
  user_prompt?: string;

  @ApiPropertyOptional({
    description: 'Array of image URLs',
    type: [String],
    format: 'url',
    example: [
      'https://res.cloudinary.com/.../image1.jpg',
      'https://res.cloudinary.com/.../image2.png',
    ],
  })
  reference_image_urls?: string[];
}
