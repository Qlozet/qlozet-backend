import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ArrayMinSize,
  IsEnum,
} from 'class-validator';

export enum AudienceType {
  MALE = 'male',
  FEMALE = 'female',
  UNISEX = 'unisex',
  KIDS = 'kids',
}
export class TaxonomyDto {
  @ApiProperty({ description: 'Type of product (e.g., clothing, accessory)' })
  @IsString()
  @IsNotEmpty()
  product_type: string;

  @ApiProperty({
    type: [String],
    description: 'Main category names (e.g., ["traditional", "formal"])',
    example: ['traditional', 'formal'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  categories: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Associated attribute tags (e.g., ["premium", "cotton"])',
    example: ['premium', 'custom'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attributes?: string[];

  @ApiProperty({
    description: 'Target audience (e.g., male, female, unisex, kids)',
    example: 'male',
  })
  @IsString()
  @IsNotEmpty()
  @IsEnum(AudienceType, {
    message: 'audience must be one of: male, female, unisex, kids',
  })
  audience: AudienceType;
}
