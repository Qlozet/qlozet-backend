import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsNumber,
  IsMongoId,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
