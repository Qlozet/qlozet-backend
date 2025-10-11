// src/modules/products/dto/review.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: 4.5, description: 'Rating value between 1 and 5' })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ example: 'This outfit is amazing!' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReviewResponseDto {
  @ApiProperty({ example: '65229b3a03c3c948df45e92a' })
  userId: string;

  @ApiProperty({ example: 'Aisha Bello' })
  username: string;

  @ApiProperty({ example: 5 })
  rating: number;

  @ApiProperty({ example: 'Loved the fabric quality!' })
  comment: string;

  @ApiProperty({ example: '2025-10-09T10:00:00.000Z' })
  createdAt: Date;
}
