import { IsString, IsArray, IsNumber, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { FeedItemDto } from './feed-response.dto';

export class VendorFeedItemDto {
    @IsString()
    vendorId: string;

    @IsString()
    vendorName: string;

    @IsNumber()
    vendorScore: number;

    @IsArray()
    @IsString({ each: true })
    reasonCodes: string[];

    @IsArray()
    @IsString({ each: true })
    explanations: string[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FeedItemDto)
    products: FeedItemDto[];

    // Optional vendor metadata
    successRate?: number;
    isFeatured?: boolean;
    totalProducts?: number;
    averageDeliveryDays?: number;
}

export class VendorFeedResponseDto {
    @IsUUID()
    requestId: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => VendorFeedItemDto)
    vendors: VendorFeedItemDto[];
}
