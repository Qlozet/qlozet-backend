import { IsEnum, IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { CatalogItemType } from '../enums/catalog-item-type.enum';

export class FitMetaDto {
    @IsString()
    @IsOptional()
    targetDemographic?: string;

    @IsString()
    @IsOptional()
    fitType?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    measurementsPoints?: string[];
}

export class CreateCatalogItemDto {
    @IsString()
    @IsNotEmpty()
    itemId: string;

    @IsEnum(CatalogItemType)
    @IsNotEmpty()
    type: CatalogItemType;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    tags?: string[];

    @IsNumber()
    @IsNotEmpty()
    price: number;

    @IsString()
    @IsNotEmpty()
    currency: string;

    @IsString()
    @IsNotEmpty()
    vendor: string;

    @IsString()
    @IsOptional()
    vendorUrl?: string;

    @IsObject()
    @IsOptional()
    rawVendorData?: Record<string, any>;

    @ValidateNested()
    @Type(() => FitMetaDto)
    @IsOptional()
    fitMeta?: FitMetaDto;

    @IsString()
    @IsOptional()
    fabricComposition?: string;

    @IsString()
    @IsOptional()
    material?: string;

    @IsString()
    @IsOptional()
    templateUrl?: string;
}
