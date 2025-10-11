import { IsArray, IsOptional, IsString } from 'class-validator';
import { Types } from 'mongoose';

// taxonomy.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaxonomyDto {
  @ApiProperty({ example: 'clothing', description: 'Product type' })
  @IsString()
  product_type: string;

  @ApiProperty({ example: 'shirts', description: 'Category' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ example: 'dress_shirts', description: 'Sub category' })
  @IsOptional()
  @IsString()
  sub_category?: string;

  @ApiPropertyOptional({
    example: ['formal', 'business'],
    description: 'Taxonomy tags',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 'men', description: 'Target audience' })
  @IsOptional()
  @IsString()
  audience?: string;
}

export class TaxonomyResponseDto {
  @ApiProperty({
    example: '67a1b2c3d4e5f67890123458',
    description: 'Taxonomy ID',
  })
  _id: Types.ObjectId;

  @ApiProperty({ example: 'clothing', description: 'Product type' })
  product_type: string;

  @ApiProperty({ example: 'shirts', description: 'Category' })
  category: string;

  @ApiPropertyOptional({ example: 'dress_shirts', description: 'Sub category' })
  sub_category?: string;

  @ApiPropertyOptional({
    example: ['formal', 'business'],
    description: 'Taxonomy tags',
  })
  tags?: string[];

  @ApiPropertyOptional({ example: 'men', description: 'Target audience' })
  audience?: string;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Creation timestamp',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Last update timestamp',
  })
  updatedAt: Date;
}
