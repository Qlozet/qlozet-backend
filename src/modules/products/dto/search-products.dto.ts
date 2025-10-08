// // dto/search-products.dto.ts
// import {
//   IsOptional,
//   IsNumber,
//   IsString,
//   IsArray,
//   Min,
//   IsEnum,
//   IsBoolean,
// } from 'class-validator';
// import { Type } from 'class-transformer';
// import { ApiPropertyOptional } from '@nestjs/swagger';
// import { ProductTag, BodyFit } from '../schemas/product.schema';

// export class SearchProductsDto {
//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsString()
//   query?: string;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   @Type(() => Number)
//   minPrice?: number;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   @Type(() => Number)
//   maxPrice?: number;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsArray()
//   @IsEnum(ProductTag, { each: true })
//   tags?: ProductTag[];

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsArray()
//   @IsEnum(BodyFit, { each: true })
//   bodyFit?: BodyFit[];

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsArray()
//   @IsEnum(Occasion, { each: true })
//   occasion?: Occasion[];

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsBoolean()
//   @Type(() => Boolean)
//   isFeatured?: boolean;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsBoolean()
//   @Type(() => Boolean)
//   isOnSale?: boolean;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsString()
//   category?: string;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsNumber()
//   @Min(1)
//   @Type(() => Number)
//   page?: number = 1;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsNumber()
//   @Min(1)
//   @Type(() => Number)
//   limit?: number = 20;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsString()
//   sortBy?: string = 'createdAt';

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsString()
//   sortOrder?: 'asc' | 'desc' = 'desc';
// }
