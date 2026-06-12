import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { Wallet, WalletSchema } from './schema/wallet.schema';
import { Token, TokenSchema, TokenTransaction, TokenTransactionSchema } from './schema/token.schema';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import { TransactionService } from '../transactions/transactions.service';
import { PaymentService } from '../payment/payment.service';
import { BusinessModule } from '../business/business.module';
import { PlatformService } from '../platform/platform.service';
import { TokenService } from './token.service';
import { CurrencyService } from '../currency/currency.service';
import { TokenController } from './token.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: Token.name, schema: TokenSchema },
      { name: TokenTransaction.name, schema: TokenTransactionSchema },
    ]),
    BusinessModule,
    HttpModule,
  ],
  controllers: [WalletsController, TokenController],
  providers: [
    WalletsService,
    TransactionService,
    JwtService,
    PaymentService,
    PlatformService,
    TokenService,
    CurrencyService,
  ],
  exports: [
    WalletsService,
    TransactionService,
    JwtService,
    PaymentService,
    PlatformService,
    TokenService,
    CurrencyService,
    MongooseModule,
  ],
})
export class WalletsModule {}

