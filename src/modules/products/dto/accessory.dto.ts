import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsMongoId,
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
import { ImageDto } from './image.dto';
import { ProductImageDto } from './product-image.dto';
import { VariantDto } from './variant.dto';
import { Types } from 'mongoose';

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
    description: 'Base price of the accessory',
    example: 5000,
  })
  @IsNotEmpty()
  @IsNumber()
  price: number;

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
    type: [VariantDto],
    description:
      'Available accessory variants (e.g., different colors or sizes)',
    example: [
      {
        color: { name: 'Black', hex: '#000' },
        size: 'M',
        stock: 20,
      },
      {
        color: { name: 'White', hex: '#fff' },
        size: 'M',
        stock: 20,
      },
    ],
  })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];

  @ApiProperty({
    type: [ProductImageDto],
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
  images?: ProductImageDto[];
}

export class UpdateAccessoryVariantStockDto {
  product_id: Types.ObjectId;
  accessory_id: Types.ObjectId;

  @ApiProperty({ example: '690f834c4d38e9188cc62f20' })
  @IsNotEmpty()
  @IsMongoId()
  variant_id: Types.ObjectId;
  @ApiProperty({
    example: 10,
    description: 'New stock value for this variant',
  })
  @IsInt()
  @Min(0)
  new_stock: number;
}
