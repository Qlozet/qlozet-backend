import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ProductKind } from '../../products/schemas/product.schema';
import { TagAssignableBy } from '../schemas/system-tag.schema';

export class CreateSystemTagDto {
  @ApiProperty({ description: 'Tag display name', example: 'Staff Pick' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    enum: ProductKind,
    description: 'Restrict tag to a specific kind, or leave empty for global',
  })
  @IsEnum(ProductKind)
  @IsOptional()
  kind?: string;

  @ApiProperty({
    enum: TagAssignableBy,
    description: 'Who can assign this tag to products',
  })
  @IsEnum(TagAssignableBy)
  assignable_by: string;

  @ApiPropertyOptional({ description: 'Sort order for display', default: 0 })
  @IsNumber()
  @IsOptional()
  sort_order?: number;

  @ApiPropertyOptional({ description: 'Whether this tag is active', default: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
