// // dto/product-status.dto.ts
// import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
// import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// import { ProductStatus } from '../schemas/product.schema';

// export class ProductStatusDto {
//   @ApiProperty({ enum: ProductStatus })
//   @IsEnum(ProductStatus)
//   status: ProductStatus;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsBoolean()
//   isFeatured?: boolean;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsBoolean()
//   isActive?: boolean;

//   @ApiPropertyOptional()
//   @IsOptional()
//   @IsBoolean()
//   isOnSale?: boolean;
// }
