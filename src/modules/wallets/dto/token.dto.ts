// src/token/token.dto.ts
// Harmless comment to trigger a fresh CI/CD deployment check
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
  /** The pack to buy (GET /token/packs). The server sets price and tokens. */
  @IsOptional()
  @IsString()
  pack_id?: string;

  /** Old apps only: a bare token count, at the dearest per-token rate, no bonus. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;
}

export class HistoryQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  size?: number;
}
