import { IsEnum, IsNumber, IsObject, IsOptional } from 'class-validator';
import { RecommendationIntent } from '../enums/recommendation-intent.enum';

export class RouterResponseDto {
    @IsEnum(RecommendationIntent)
    intent: RecommendationIntent;

    @IsObject()
    @IsOptional()
    constraints?: Record<string, any>;

    @IsNumber()
    confidence: number;
}
