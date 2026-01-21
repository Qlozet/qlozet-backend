import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/** ---------------- Create Transfer Recipient ---------------- */
export class CreateTransferRecipientDto {
  @ApiProperty({ description: 'Full name of the recipient or business' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Bank account number of the recipient' })
  @IsString()
  @IsNotEmpty()
  account_number: string;

  @ApiProperty({ description: 'Bank code of the recipient account' })
  @IsString()
  @IsNotEmpty()
  bank_code: string;

  @ApiPropertyOptional({
    description: 'Currency of the account, default NGN',
    default: 'NGN',
  })
  @IsString()
  @IsOptional()
  currency?: string = 'NGN';

  @ApiPropertyOptional({
    description: 'Type of recipient, default nuban',
    default: 'nuban',
  })
  @IsString()
  @IsOptional()
  type?: string = 'nuban';
}

/** ---------------- Verify Bank Account ---------------- */
export class VerifyBankAccountDto {
  @ApiProperty({ description: 'Bank account number to verify' })
  @IsString()
  @IsNotEmpty()
  account_number: string;

  @ApiProperty({ description: 'Bank code of the account' })
  @IsString()
  @IsNotEmpty()
  bank_code: string;
}
