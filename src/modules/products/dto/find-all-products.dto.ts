import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class FindAllProductsDto {
  @ApiPropertyOptional({
    description: 'Page number (for pagination)',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  size?: number = 10;

  @ApiPropertyOptional({
    description: 'Product kind (e.g., clothing, fabric, accessory)',
  })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({ description: 'Search keyword to match product name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Sort by rating, date, or relevance',
    enum: ['rating', 'date', 'relevance'],
  })
  @IsOptional()
  @IsEnum(['rating', 'date', 'relevance'], {
    message: 'sortBy must be either rating, date, or relevance',
  })
  sortBy?: 'rating' | 'date' | 'relevance';

  @ApiPropertyOptional({
    description: 'Sort order: asc (ascending) or desc (descending)',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'], {
    message: 'order must be either asc or desc',
  })
  order?: 'asc' | 'desc' = 'desc';
}
