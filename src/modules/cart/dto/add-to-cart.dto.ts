import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsNumber,
  IsMongoId,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderItemSelectionsDto } from '../../orders/dto/selection.dto';

export class AddToCartDto {
  @ApiProperty({
    description: 'Product ID to add to cart',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId({ message: 'productId must be a valid MongoDB ObjectId' })
  @IsNotEmpty({ message: 'productId is required' })
  productId: string;

  @ApiPropertyOptional({
    description: 'Quantity to add',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  quantity?: number = 1;

  @ApiPropertyOptional({
    description: 'ID of an external fabric product to apply (for custom clothing)',
    example: '507f1f77bcf86cd799439022',
  })
  @IsOptional()
  @IsMongoId({ message: 'appliedFabricId must be a valid MongoDB ObjectId' })
  appliedFabricId?: string;

  @ApiPropertyOptional({
    description: 'Number of yards of the applied fabric',
    example: 3.5,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'appliedFabricYards must be a number' })
  @Min(0, { message: 'appliedFabricYards must be non-negative' })
  appliedFabricYards?: number;

  @ApiPropertyOptional({
    description: 'Optional note for this cart item',
  })
  @IsOptional()
  @IsString({ message: 'note must be a string' })
  note?: string;

  @ApiPropertyOptional({
    type: OrderItemSelectionsDto,
    description:
      'Product selections (color variants, fabrics, styles, accessories, addons). ' +
      'These are persisted and forwarded to POST /orders when placing an order.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderItemSelectionsDto)
  selections?: OrderItemSelectionsDto;

  @ApiPropertyOptional({
    description:
      "The line's identity as the shop computes it (product, size, colour, selections, applied fabric, measurement profile). Adding the same key again raises that line's quantity; a different key is a separate line. Omitted = keyed by product id, the old behaviour.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  lineKey?: string;

  @ApiPropertyOptional({ description: 'Size shown on the line' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  size?: string;

  @ApiPropertyOptional({ description: 'Colour shown on the line' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;

  @ApiPropertyOptional({ description: 'Saved measurement set the garment is sewn to' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  measurementSet?: string;

  @IsOptional()
  @IsString()
  appliedFabricSize?: string;
}

export class UpdateCartLineDto {
  @ApiProperty({ example: 2, minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity: number;
}

export class MergeCartDto {
  @ApiProperty({
    type: [AddToCartDto],
    description: 'The guest cart to move into the account, once, at sign-in.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AddToCartDto)
  items: AddToCartDto[];
}
