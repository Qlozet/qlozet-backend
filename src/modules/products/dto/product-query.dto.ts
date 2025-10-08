// // dto/product-query.dto.ts
// import {
//   IsOptional,
//   IsNumber,
//   IsString,
//   IsArray,
//   Min,
//   IsEnum,
// } from 'class-validator';
// import { Type } from 'class-transformer';
// import { ApiPropertyOptional } from '@nestjs/swagger';
// import { ProductStatus, ProductTag } from '../schemas/product.schema';

// export class ProductQueryDto {
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
//   limit?: number = 10;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsEnum(ProductStatus)
//   status?: ProductStatus;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsString()
//   search?: string;

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
//   @IsString()
//   sortBy?: string = 'createdAt';

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsString()
//   sortOrder?: 'asc' | 'desc' = 'desc';
// }
