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

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [WalletsController],
  providers: [WalletsService, TransactionService, JwtService],
})
export class WalletsModule {}
