import { Global, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { Permission, PermissionSchema } from '../ums/schemas/permission.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';
import { Address, AddressSchema } from '../ums/schemas/address.schema';
import { Token, TokenSchema } from '../wallets/schema/token.schema';
import { Wallet, WalletSchema } from '../wallets/schema/wallet.schema';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../platform/schema/platformSettings.schema';
import {
  FabricReservation,
  FabricReservationSchema,
} from '../fabric-reservation/schemas/fabric-reservation.schema';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RolesGuard,
} from '../../common/guards';
import { PermissionService } from '../ums/services/permissions.service';
import { UserService } from '../ums/services';
import { LogisticsModule } from '../logistics/logistics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SizeGuideModule } from '../size-guide/size-guide.module';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Token.name, schema: TokenSchema },
      { name: Wallet.name, schema: WalletSchema },
      // AuthModule provides UserService itself (see providers below), so it
      // must register every model UserService injects — registering Order in
      // UmsModule alone is not enough, and the mismatch fails at DI time on
      // boot, not at compile time.
      { name: Order.name, schema: OrderSchema },
      // Same reason: UserService.getCustomerDetail reads authored product
      // ratings and organised fabric reservations for the admin console.
      { name: Product.name, schema: ProductSchema },
      { name: FabricReservation.name, schema: FabricReservationSchema },
      // Signup token reward amount is an admin-tunable platform setting.
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN') || '1d',
        },
      }),
      inject: [ConfigService],
    }),
    LogisticsModule,       // provides LogisticsService
    NotificationsModule,   // provides MailService
    forwardRef(() => SizeGuideModule),  // provides SizeGuideService (needed by UserService)
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PermissionService,  // pragmatic: AuthModule already registers User/Role schemas
    UserService,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    PermissionService,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    JwtModule,
    MongooseModule,
  ],
})
export class AuthModule {}

