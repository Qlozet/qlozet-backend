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

    /** Colour words the shopper asked for; an item passes if it offers any of them. */
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    colors?: string[];

    /** A size the shopper asked for; items that list sizes must list this one. */
    @IsString()
    @IsOptional()
    size?: string;
}
