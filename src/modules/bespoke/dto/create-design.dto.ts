import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  IsOptional,
  IsMongoId,
  ArrayMinSize,
} from 'class-validator';

export class CreateDesignDto {
  @ApiProperty({ example: 'My Wedding Agbada' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Agbada' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ enum: ['men', 'women'], example: 'men' })
  @IsEnum(['men', 'women'])
  gender: string;

  @ApiProperty({
    description: 'Cloudinary URLs of AI-generated design images',
    example: ['https://res.cloudinary.com/.../design1.jpg'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  design_images: string[];

  @ApiPropertyOptional({
    description: 'Cloudinary URLs of customer reference photos',
    example: ['https://res.cloudinary.com/.../ref1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reference_images?: string[];

  @ApiPropertyOptional({
    description: 'Product ID of the selected fabric (kind: fabric)',
    example: '665abc123def456ghi789jkl',
  })
  @IsOptional()
  @IsMongoId()
  fabric_id?: string;

  @ApiPropertyOptional({ example: 'I want a modern take on traditional agbada' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'ID of the customer measurement set to attach',
  })
  @IsOptional()
  @IsMongoId()
  measurement_id?: string;
}
