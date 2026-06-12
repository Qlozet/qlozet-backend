import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { Wallet, WalletSchema } from './schema/wallet.schema';
import { Token, TokenSchema, TokenTransaction, TokenTransactionSchema } from './schema/token.schema';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { TokenController } from './token.controller';

// Import modules instead of directly listing their services
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentModule } from '../payment/payment.module';
import { CurrencyModule } from '../currency/currency.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: Token.name, schema: TokenSchema },
      { name: TokenTransaction.name, schema: TokenTransactionSchema },
    ]),
    TransactionsModule,  // provides TransactionService
    PaymentModule,       // provides PaymentService
    CurrencyModule,      // provides CurrencyService
    PlatformModule,      // provides PlatformService (needed by TokenService)
  ],
  controllers: [WalletsController, TokenController],
  providers: [
    WalletsService,
    JwtService,
    TokenService,
  ],
  exports: [
    WalletsService,
    TokenService,
    MongooseModule,
  ],
})
export class WalletsModule {}
