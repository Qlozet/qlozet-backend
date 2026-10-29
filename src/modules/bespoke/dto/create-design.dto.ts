import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  IsOptional,
  IsMongoId,
  ArrayMinSize,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BackViewDto {
  @ApiProperty({ description: 'The front design image this back view was made from' })
  @IsString()
  @IsNotEmpty()
  front: string;

  @ApiProperty({ description: 'The back view image' })
  @IsString()
  @IsNotEmpty()
  back: string;
}

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
    description:
      'Back views, each tied to a front in design_images. Omit on update to keep the saved ones.',
    type: [BackViewDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BackViewDto)
  back_views?: BackViewDto[];

  @ApiPropertyOptional({
    description:
      'false: tailors see only the chosen version (design_images[0]) and its back view.',
  })
  @IsOptional()
  @IsBoolean()
  show_other_versions?: boolean;

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
