import { IsEnum, IsString, IsNotEmpty, IsOptional, IsObject, IsDateString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EventType } from '../enums/event-type.enum';

export class EventContextDto {
    @IsString()
    @IsOptional()
    surface?: string;

    @IsString()
    @IsOptional()
    requestId?: string;

    @IsNumber()
    @IsOptional()
    position?: number;

    @IsString()
    @IsOptional()
    stream?: string;
}

export class EventMetadataDto {
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    reasonCodes?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    seenIds?: string[];

    @IsString()
    @IsOptional()
    query?: string;

    @IsObject()
    @IsOptional()
    filters?: Record<string, any>;

    @IsNumber()
    @IsOptional()
    budgetMax?: number;

    @IsNumber()
    @IsOptional()
    deadlineDays?: number;

    @IsNumber()
    @IsOptional()
    dwellMs?: number;
}

export class CreateEventDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    @IsEnum(EventType)
    @IsNotEmpty()
    eventType: EventType;

    @IsObject()
    @IsOptional()
    properties?: Record<string, any>;

    @IsObject()
    @IsOptional()
    @ValidateNested()
    @Type(() => EventContextDto)
    context?: EventContextDto;

    @IsObject()
    @IsOptional()
    @ValidateNested()
    @Type(() => EventMetadataDto)
    metadata?: EventMetadataDto;

    @IsDateString()
    @IsOptional()
    timestamp?: string;
}
