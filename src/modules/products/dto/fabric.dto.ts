import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductImageDto } from './product-image.dto';
import { VariantDto } from './variant.dto';
import { ColorDto } from './product.dto';
import { Types } from 'mongoose';

export class FabricDto {
  @ApiProperty({
    description: 'Fabric name',
    example: 'Qlozet Royal Blue Cotton',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Detailed fabric description',
    example:
      'High-thread-count royal blue cotton fabric with a soft, breathable finish. Ideal for kaftans and agbadas.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'cotton',
    description: 'Type or material of fabric',
  })
  @IsString()
  product_type: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColorDto)
  colors?: ColorDto[];

  @ApiPropertyOptional({
    example: 'striped',
    description:
      'Pattern or style of the fabric (plain, striped, floral, etc.)',
  })
  @IsOptional()
  @IsString()
  pattern?: string;

  @ApiProperty({
    example: 2.5,
    description: 'Yard length per roll (in yards)',
  })
  @IsNumber()
  @Min(0.1)
  yard_length: number;

  @ApiProperty({
    example: 60,
    description: 'Fabric width (in inches)',
  })
  @IsNumber()
  @Min(10)
  width: number;

  @ApiProperty({
    example: 1,
    description: 'Minimum cut allowed (in yards)',
  })
  @IsNumber()
  @Min(0.1)
  min_cut: number;

  @ApiProperty({
    example: 2500,
    description: 'Price per yard in Naira',
  })
  @IsNumber()
  @Min(0)
  price_per_yard: number;

  @ApiPropertyOptional({
    type: [ProductImageDto],
    description: 'Fabric sample or preview images',
    example: [
      {
        public_id: 'qlozet/fabrics/royal-blue-cotton',
        url: 'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/royal-blue-cotton.jpg',
        width: 800,
        height: 600,
      },
      {
        public_id: 'qlozet/fabrics/navy-blue-cotton',
        url: 'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/navy-blue-cotton.jpg',
        width: 800,
        height: 600,
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
  @ApiPropertyOptional({
    type: [VariantDto],
    description: 'Available  variants',
    example: [
      {
        size: 'L',
        stock: 15,
        price: 16000,
        sku: 'QZT-KFTN-L-BLUE',
        yard_per_order: 5,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];
}
export class UpdateFabricStockDto {
  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  new_yard_length: number;
}

export class FabricParamDto {
  @ApiProperty({
    description: 'ID of the product',
    example: '690f834c4d38e9188cc62f1b',
  })
  product_id: string;

  @ApiProperty({
    description: 'ID of the fabric',
    example: '690f834c4d38e9188cc62f22',
  })
  fabric_id: string;
}
