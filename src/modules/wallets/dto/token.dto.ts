// src/token/token.dto.ts
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class EarnDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  feature?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class SpendDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  feature?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class PurchaseDto {
  @IsNumber()
  @Min(1)
  amount: number;
}

export class HistoryQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  size?: number;
}
