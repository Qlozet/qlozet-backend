import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─────────────────────────────────────────────────────────
// Wallet Balance Response
// ─────────────────────────────────────────────────────────

export class WalletBalanceResponseDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0' })
  _id: string;

  @ApiPropertyOptional({
    example: '6650a1b2c3d4e5f6a7b8c9d1',
    description: 'Business ID (for vendor wallets)',
  })
  business?: string;

  @ApiPropertyOptional({
    example: '6650a1b2c3d4e5f6a7b8c9d2',
    description: 'Customer/User ID (for customer wallets)',
  })
  customer?: string;

  @ApiProperty({ example: 25000, description: 'Current wallet balance' })
  balance: number;

  @ApiProperty({ example: 0, description: 'Pending balance (held funds)' })
  pending_balance: number;

  @ApiProperty({ example: 'NGN', description: 'Wallet currency' })
  currency: string;

  @ApiPropertyOptional({
    example: '2026-07-01T12:00:00.000Z',
    description: 'Timestamp of last transaction',
  })
  last_transaction_at?: string;

  @ApiProperty({
    example: 'active',
    enum: ['active', 'suspended', 'closed'],
    description: 'Wallet status',
  })
  status: string;

  @ApiPropertyOptional({ example: '0123456789', description: 'Bank account number' })
  account_number?: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Bank account name' })
  account_name?: string;

  @ApiPropertyOptional({ example: 'GTBank', description: 'Bank name' })
  bank_name?: string;
}

// ─────────────────────────────────────────────────────────
// Fund Wallet Response
// ─────────────────────────────────────────────────────────

export class FundWalletDataDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0', description: 'Wallet ID' })
  walletId: string;

  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d3', description: 'Transaction ID' })
  transactionId: string;

  @ApiProperty({
    example: 'https://checkout.paystack.com/abc123',
    description: 'Paystack payment URL — redirect the user here',
  })
  authorization_url: string;

  @ApiProperty({ example: 'TXN_abc123', description: 'Transaction reference' })
  reference: string;

  @ApiProperty({ example: 'abc123', description: 'Paystack access code' })
  access_code: string;
}

export class FundWalletResponseDto {
  @ApiProperty({ example: 'Wallet funding initialized' })
  message: string;

  @ApiProperty({ type: FundWalletDataDto })
  data: FundWalletDataDto;
}

// ─────────────────────────────────────────────────────────
// Verify Payment Response
// ─────────────────────────────────────────────────────────

export class VerifyPaymentResponseDto {
  @ApiProperty({
    example: 'success',
    enum: ['success', 'failed', 'pending'],
    description: 'Payment verification status',
  })
  status: string;

  @ApiPropertyOptional({
    example: '6650a1b2c3d4e5f6a7b8c9d0',
    description: 'Wallet ID (present on success)',
  })
  walletId?: string;

  @ApiProperty({ example: 5000, description: 'Payment amount' })
  amount: number;

  @ApiPropertyOptional({
    example: false,
    description: 'True if this payment was already processed (prevents double-credit)',
  })
  alreadyProcessed?: boolean;
}

// ─────────────────────────────────────────────────────────
// Token Price Response
// ─────────────────────────────────────────────────────────

export class TokenPriceResponseDto {
  @ApiProperty({ example: 100, description: 'Number of tokens requested' })
  tokens: number;

  @ApiProperty({ example: 'NGN', description: 'Currency for the price' })
  currency: string;

  @ApiProperty({ example: 1500, description: 'Price in the requested currency' })
  amount: number;
}
