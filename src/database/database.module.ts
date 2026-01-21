import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Business,
  BusinessSchema,
} from '../modules/business/schemas/business.schema';
import { User, UserSchema } from '../modules/ums/schemas/user.schema';
import { Role, RoleSchema } from '../modules/ums/schemas/role.schema';
import {
  Product,
  ProductSchema,
} from '../modules/products/schemas/product.schema';
import {
  PermissionSchema,
  Permission,
} from '../modules/ums/schemas/permission.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from 'src/modules/ums/schemas/team.schema';
import { Address, AddressSchema } from '../modules/ums/schemas/address.schema';
import {
  WarehouseSchema,
  Warehouse,
} from '../modules/business/schemas/warehouse.schema';
import { Order, OrderSchema } from '../modules/orders/schemas/orders.schema';
import { TicketSchema, Ticket } from '../modules/ticket/schema/ticket.schema';
import {
  TicketReply,
  TicketReplySchema,
} from '../modules/ticket/schema/reply-ticket.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../modules/platform/schema/platformSettings.schema';
import { WalletSchema, Wallet } from '../modules/wallets/schema/wallet.schema';
import {
  Discount,
  Style,
  Accessory,
  Clothing,
  ClothingSchema,
  FabricSchema,
  Fabric,
  Variant,
  VariantSchema,
  StyleSchema,
  AccessorySchema,
  DiscountSchema,
  CollectionSchema,
  Collection,
} from 'src/modules/products/schemas';
import {
  TransactionSchema,
  Transaction,
} from '../modules/transactions/schema/transaction.schema';
import { CartSchema, Cart } from '../modules/cart/schema/cart.schema';
import {
  Token,
  TokenSchema,
  TokenTransaction,
  TokenTransactionSchema,
} from 'src/modules/wallets/schema/token.schema';
import {
  JobStatus,
  JobStatusSchema,
} from 'src/common/schemas/job-status.schema';
import {
  BusinessEarning,
  BusinessEarningSchema,
} from 'src/modules/business/schemas/business-earnings.schema';

@Module({
  exports: [MongooseModule],
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        bufferCommands: false,
        serverSelectionTimeoutMS: 30000,
      }),
      inject: [ConfigService],
    }),

    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Product.name, schema: ProductSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: TicketReply.name, schema: TicketReplySchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Accessory.name, schema: AccessorySchema },
      { name: Cart.name, schema: CartSchema },
      { name: Style.name, schema: StyleSchema },
      { name: Fabric.name, schema: FabricSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Variant.name, schema: VariantSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Clothing.name, schema: ClothingSchema },
      { name: Collection.name, schema: CollectionSchema },
      { name: Token.name, schema: TokenSchema },
      { name: TokenTransaction.name, schema: TokenTransactionSchema },
      { name: JobStatus.name, schema: JobStatusSchema },
    ]),
  ],
})
export class DatabaseModule {}
