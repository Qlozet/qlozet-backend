import { IsString, IsArray, IsNumber, ValidateNested, IsUUID, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ReasonCode } from '../enums/reason-code.enum';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';

export class FeedItemDto {
    @IsString()
    itemId: string;

    @IsNumber()
    position: number;

    @IsString()
    stream: string;

    @IsArray()
    @IsEnum(ReasonCode, { each: true })
    reasonCodes: ReasonCode[];

    @IsArray()
    @IsString({ each: true })
    explanations: string[];

    // Include full item details (inherited or mapped)
    // For DTO simplicity we just map known fields, or use intersection types if strictly typed
    @IsString()
    name: string;

    @IsNumber()
    price: number;

    @IsString()
    vendor: string;

    // ... Any other catalog fields needed
}

export class FeedResponseDto {
    @IsUUID()
    requestId: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FeedItemDto)
    items: FeedItemDto[];

    // Debug info optional
    debug?: any;
}
