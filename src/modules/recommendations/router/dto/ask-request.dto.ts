import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsNumber,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AskRequestDto {
  @ApiProperty({
    description: 'Natural language fashion query',
    example: 'Show me red dresses for a wedding under 50k',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty({ message: 'Query is required' })
  @MaxLength(500, { message: 'Query too long (max 500 characters)' })
  query: string;

  @ApiProperty({ required: false, description: 'User ID for personalization' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ required: false, description: 'Session ID for context' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({
    required: false,
    description: 'Max products to return (default 10, max 20)',
    default: 10,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20, { message: 'Limit must be ≤ 20' })
  limit?: number;
}
