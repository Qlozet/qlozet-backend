import { IsNumber, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FundWalletDto {
  @ApiProperty({
    description: 'Amount to fund the wallet with',
    example: 5000,
  })
  @IsNumber()
  amount: number;
}
