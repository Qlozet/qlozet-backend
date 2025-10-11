// product.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  IsEnum,
  IsMongoId,
  Min,
  ValidateNested,
  IsObject,
  ValidateIf,
  IsNotEmpty,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ImageDto } from './base.dto';
import { FabricDto } from './fabric.dto';
import { AccessoryDto } from './accessory.dto';
import { CreateStyleDto } from './style.dto';
import {
  ForbiddenForKind,
  RequiredForKind,
} from '../../../common/validators/kind-specific.validator';

export class CreateProductDto {
  @ApiProperty({
    enum: ['clothing', 'fabric', 'accessory'],
    example: 'clothing',
  })
  @IsEnum(['clothing', 'fabric', 'accessory'])
  kind: string;

  @ApiProperty({ example: 'Fashion Collection' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: '67a1b2c3d4e5f67890123458' })
  @IsOptional()
  @IsMongoId()
  taxonomy?: string;

  @ApiPropertyOptional({
    enum: ['active', 'draft', 'archived'],
    example: 'active',
  })
  @IsOptional()
  @IsEnum(['active', 'draft', 'archived'])
  status?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_customizable?: boolean;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  turnaround_days?: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  base_price: number;

  @ApiPropertyOptional({ type: [ImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiPropertyOptional({
    example: { title: 'SEO Title', description: 'SEO Description' },
  })
  @IsOptional()
  @IsObject()
  seo?: Record<string, any>;

  @ApiPropertyOptional({ example: { care_instructions: 'Machine wash cold' } })
  @IsOptional()
  @IsObject()
  metafields?: Record<string, any>;

  // Fabric - required for 'fabric' kind, forbidden for others
  @ApiPropertyOptional({ type: FabricDto })
  @RequiredForKind(['fabric'])
  @ForbiddenForKind(['clothing', 'accessory'])
  @ValidateNested()
  @Type(() => FabricDto)
  fabrics?: FabricDto;

  @ApiPropertyOptional({ type: CreateStyleDto })
  @RequiredForKind(['clothing'])
  @ForbiddenForKind(['accessory', 'fabric'])
  @ValidateNested()
  @Type(() => CreateStyleDto)
  @IsNotEmpty({
    message: 'Style data is required when clothing is customizable',
  })
  styles?: CreateStyleDto;

  @ApiPropertyOptional({ type: AccessoryDto })
  @RequiredForKind(['accessory'])
  @ForbiddenForKind(['clothing', 'fabric'])
  @ValidateNested()
  @Type(() => AccessoryDto)
  accessories?: AccessoryDto;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Updated Product Title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: '67a1b2c3d4e5f67890123458' })
  @IsOptional()
  @IsMongoId()
  taxonomy?: string;

  kind: string;
  @ApiPropertyOptional({ enum: ['active', 'draft', 'archived'] })
  @IsOptional()
  @IsEnum(['active', 'draft', 'archived'])
  status?: string;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  base_price?: number;

  @ApiPropertyOptional({ type: [ImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];

  @ApiPropertyOptional({ example: { title: 'Updated SEO' } })
  @IsOptional()
  @IsObject()
  seo?: Record<string, any>;

  @ApiPropertyOptional({ example: { material: 'silk' } })
  @IsOptional()
  @IsObject()
  metafields?: Record<string, any>;

  @ApiPropertyOptional({ type: FabricDto })
  @ValidateIf((o) => o.kind === 'fabric' || o.fabrics !== undefined)
  @ValidateNested()
  @Type(() => FabricDto)
  @IsNotEmpty({ message: 'Fabric data is required when kind is "fabric"' })
  fabrics?: FabricDto;

  @ApiPropertyOptional({ type: CreateStyleDto })
  @ValidateIf(
    (o) =>
      (o.kind === 'clothing' && o.is_customizable === true) ||
      o.styles !== undefined,
  )
  @ValidateNested()
  @Type(() => CreateStyleDto)
  @IsNotEmpty({
    message: 'Style data is required when clothing is customizable',
  })
  styles?: CreateStyleDto;

  @ApiPropertyOptional({ type: AccessoryDto })
  @ValidateIf((o) => o.kind === 'accessory' || o.accessories !== undefined)
  @ValidateNested()
  @Type(() => AccessoryDto)
  @IsNotEmpty({
    message: 'Accessory data is required when kind is "accessory"',
  })
  accessories?: AccessoryDto;
}
