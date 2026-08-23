import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
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

  @ApiPropertyOptional({ description: 'Filter by exact product type (e.g. Dresses)' })
  @IsOptional()
  @IsString()
  product_type?: string;

  @ApiPropertyOptional({ description: 'Filter by category (e.g. Casual)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by audience (e.g. male, female, unisex, kids)' })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({
    enum: ['active', 'draft', 'archived'],
  })
  @IsOptional()
  @IsEnum(['active', 'draft', 'archived'])
  status?: 'active' | 'draft' | 'archived';

  @ApiPropertyOptional({
    description: 'Minimum effective price (discounted_price if set, else base_price)',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? value : Number(value)))
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Maximum effective price (discounted_price if set, else base_price)',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? value : Number(value)))
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only products currently on sale (discount_percentage > 0)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  on_sale?: boolean;

  @ApiPropertyOptional({ description: 'Only products that are in stock' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  in_stock?: boolean;

  @ApiPropertyOptional({ description: "Clothing type ('customize' | 'non_customize')" })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    enum: ['rating', 'date', 'relevance', 'price'],
  })
  @IsOptional()
  @IsEnum(['rating', 'date', 'relevance', 'price'])
  sortBy?: 'rating' | 'date' | 'relevance' | 'price';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
