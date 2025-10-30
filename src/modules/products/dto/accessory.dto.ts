import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaxonomyDto } from './taxonomy.dto';
import { VariantDto } from './variant.dto';
import { ImageDto } from './image.dto';

export class AccessoryDto {
  @ApiProperty({
    description: 'Accessory name',
    example: 'Qlozet Leather Belt',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Accessory description',
    example:
      'Premium handcrafted leather belt by Qlozet, designed for everyday comfort and durability.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 8500,
    description: 'Base price in Naira',
  })
  @IsNumber()
  @Min(0)
  base_price: number;

  @ApiProperty({
    type: TaxonomyDto,
    description: 'Taxonomy information for categorization',
    example: {
      product_type: 'accessory',
      categories: ['Belt'],
      attributes: ['leather', 'fashion', 'men', 'qlozet'],
      audience: 'men',
    },
  })
  @ValidateNested({ each: true })
  @Type(() => TaxonomyDto)
  taxonomy: TaxonomyDto;

  @ApiProperty({
    type: VariantDto,
    description:
      'Available accessory variants (e.g., different colors or sizes)',
    example: {
      color: ['Black'],
      size: 'M',
      price: 8800,
      stock: 20,
    },
  })
  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variant: VariantDto;

  @ApiProperty({
    type: [ImageDto],
    description: 'Accessory images',
    example: [
      {
        public_id: 'qlozet/accessories/belt-black',
        url: 'https://res.cloudinary.com/qlozet/image/upload/v1/accessories/belt-black.jpg',
        width: 800,
        height: 600,
      },
      {
        public_id: 'qlozet/accessories/belt-brown',
        url: 'https://res.cloudinary.com/qlozet/image/upload/v1/accessories/belt-brown.jpg',
        width: 800,
        height: 600,
      },
    ],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];
}
