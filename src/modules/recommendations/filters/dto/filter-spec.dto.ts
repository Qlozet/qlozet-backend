import { IsBoolean, IsNumber, IsOptional, IsString, IsArray } from 'class-validator';

export class FilterSpec {
    @IsBoolean()
    @IsOptional()
    inStockOnly?: boolean = true;

    @IsNumber()
    @IsOptional()
    maxPrice?: number;

    @IsString()
    @IsOptional()
    deliveryRegion?: string = 'ng';

    @IsNumber()
    @IsOptional()
    deadlineDays?: number;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    blockedVendors?: string[];

    @IsString()
    @IsOptional()
    gender?: string;

    @IsString()
    @IsOptional()
    category?: string;
}
