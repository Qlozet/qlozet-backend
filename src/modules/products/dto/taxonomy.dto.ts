import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  ArrayMinSize,
  IsEnum,
} from 'class-validator';

export enum AudienceType {
  MEN = 'men',
  WOMEN = 'women',
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

  @ApiProperty({
    type: [String],
    description: 'Associated attribute tags (e.g., ["premium", "cotton"])',
    example: ['premium', 'custom'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  attributes: string[];

  @ApiProperty({
    description: 'Target audience (e.g., men, women, unisex, kids)',
    example: 'men',
  })
  @IsString()
  @IsNotEmpty()
  @IsEnum(AudienceType, {
    message: 'audience must be one of: men, women, unisex, kids',
  })
  audience: AudienceType;
}
