import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { Wallet, WalletSchema } from './schema/wallet.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionService } from '../transactions/transactions.service';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schema/transaction.schema';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { PaymentService } from '../payment/payment.service';
import { BusinessModule } from '../business/business.module';
import { PlatformService } from '../platform/platform.service';
import {
  PlatformSettingsSchema,
  PlatformSettings,
} from '../platform/schema/platformSettings.schema';
import { BusinessSchema, Business } from '../business/schemas/business.schema';
import {
  WarehouseSchema,
  Warehouse,
} from '../business/schemas/warehouse.schema';
import { DatabaseModule } from 'src/database/database.module';
import { TokenService } from './token.service';
import { CurrencyService } from '../currency/currency.service';

@Module({
  imports: [BusinessModule, HttpModule, DatabaseModule],
  controllers: [WalletsController],
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
  ],
})
export class WalletsModule {}
