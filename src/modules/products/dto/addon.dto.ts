import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddOnVariantDto {
  @ApiProperty({ example: 'Gold', description: 'Variant name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 500, description: 'Price for this variant' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: '#D4AF37',
    description: 'Hex colour code (used when parent display_type = "colour")',
  })
  @IsOptional()
  @IsString()
  color_hex?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/...',
    description: 'Image URL (used when parent display_type = "picture")',
  })
  @IsOptional()
  @IsString()
  image_url?: string;
}

export class AddOnDto {
  @ApiProperty({ example: 'Buttons', description: 'Add-on category name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: ['colour', 'picture'],
    example: 'colour',
    description:
      'How variants are displayed — "colour" shows hex swatches, "picture" shows image thumbnails',
  })
  @IsEnum(['colour', 'picture'], {
    message: 'display_type must be either "colour" or "picture"',
  })
  display_type: 'colour' | 'picture';

  @ApiProperty({
    type: [AddOnVariantDto],
    description: 'Available variants for this add-on',
    example: [
      { name: 'Gold', price: 500, color_hex: '#D4AF37' },
      { name: 'Silver', price: 400, color_hex: '#C0C0C0' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddOnVariantDto)
  variants: AddOnVariantDto[];
}
