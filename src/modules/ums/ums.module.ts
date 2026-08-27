import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RolesService, UserService } from './services';
import { PermissionService } from './services/permissions.service';
import { SeedService } from './services/seed.service';
import { UserController } from './users.controller';
import { TeamService } from './services/team.service';
import { AdminsService } from './services/admins.service';
import { JwtService } from '@nestjs/jwt';

// Import modules instead of directly listing foreign services
import { LogisticsModule } from '../logistics/logistics.module';
import { ProductModule } from '../products/products.module';
import { PlatformModule } from '../platform/platform.module';
import { BusinessModule } from '../business/business.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SizeGuideModule } from '../size-guide/size-guide.module';

import { User, UserSchema } from './schemas/user.schema';
import { Address, AddressSchema } from './schemas/address.schema';
import { TeamMember, TeamMemberSchema } from './schemas/team.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Wallet, WalletSchema } from '../wallets/schema/wallet.schema';
import { Token, TokenSchema } from '../wallets/schema/token.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  FabricReservation,
  FabricReservationSchema,
} from '../fabric-reservation/schemas/fabric-reservation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Address.name, schema: AddressSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Business.name, schema: BusinessSchema },
      // Read-only: the admin customers list joins order stats per row.
      { name: Order.name, schema: OrderSchema },
      // Read-only: the admin customer DETAIL header reads a wallet balance, a
      // token balance, the product ratings they authored and the fabric
      // reservations they organised.
      { name: Wallet.name, schema: WalletSchema },
      { name: Token.name, schema: TokenSchema },
      { name: Product.name, schema: ProductSchema },
      { name: FabricReservation.name, schema: FabricReservationSchema },
    ]),
    LogisticsModule,   // provides LogisticsService (needed by UserService)
    ProductModule,     // provides ProductService
    forwardRef(() => PlatformModule),  // forwardRef: UmsModule ↔ PlatformModule circular
    BusinessModule,          // provides BusinessService (needed by UserController)
    NotificationsModule,     // provides MailService
    forwardRef(() => SizeGuideModule),  // forwardRef: UmsModule ↔ SizeGuideModule (fitting products cache)
  ],
  controllers: [UserController],
  providers: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    AdminsService,
    JwtService,
  ],
  exports: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    AdminsService,
    JwtService,
    MongooseModule,
  ],
})
export class UmsModule {}
