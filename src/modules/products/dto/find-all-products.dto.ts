import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class FindAllProductsDto {
  @ApiPropertyOptional({
    description: 'Business ID to fetch products for a specific vendor',
  })
  @IsOptional()
  @IsMongoId()
  business_id?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  size?: number = 10;

  @ApiPropertyOptional({
    description: 'Product kind (clothing, fabric, accessory)',
  })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({ description: 'Search keyword' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['active', 'draft', 'archived'],
  })
  @IsOptional()
  @IsEnum(['active', 'draft', 'archived'])
  status?: 'active' | 'draft' | 'archived';

  @ApiPropertyOptional({
    enum: ['rating', 'date', 'relevance'],
  })
  @IsOptional()
  @IsEnum(['rating', 'date', 'relevance'])
  sortBy?: 'rating' | 'date' | 'relevance';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
