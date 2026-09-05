import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { Business, BusinessSchema } from './schemas/business.schema';
import { BusinessEarning, BusinessEarningSchema } from './schemas/business-earnings.schema';
import {
  VendorNote,
  VendorNoteSchema,
} from './schemas/vendor-note.schema';
import { VendorNotesService } from './vendor-notes.service';
import { Warehouse, WarehouseSchema } from './schemas/warehouse.schema';
import { PlatformSettings, PlatformSettingsSchema } from '../platform/schema/platformSettings.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Wallet, WalletSchema } from '../wallets/schema/wallet.schema';
import {
  Token,
  TokenSchema,
  TokenTransaction,
  TokenTransactionSchema,
} from '../wallets/schema/token.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schema/transaction.schema';
import { JwtService } from '@nestjs/jwt';
import { BusinessEarningsCron } from './business-earning-cron';

// Import modules instead of directly listing services
import { LogisticsModule } from '../logistics/logistics.module';
import { ProductModule } from '../products/products.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: VendorNote.name, schema: VendorNoteSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
      // Vendor signup token reward, granted on first approval.
      { name: Token.name, schema: TokenSchema },
      { name: TokenTransaction.name, schema: TokenTransactionSchema },
    ]),
    LogisticsModule,   // provides LogisticsService
    ProductModule,     // provides ProductService
    NotificationsModule, // provides NotificationsService (payout notifications)
  ],
  controllers: [BusinessController],
  exports: [
    BusinessService,
    BusinessEarningsCron,
    MongooseModule, VendorNotesService],
  providers: [
    BusinessService,
    JwtService,
    BusinessEarningsCron, VendorNotesService],
})
export class BusinessModule {}
