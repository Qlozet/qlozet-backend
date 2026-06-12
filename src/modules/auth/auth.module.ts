import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
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
import {
  JwtAuthGuard,
  PermissionsGuard,
  RolesGuard,
} from '../../common/guards';
import { PermissionService } from '../ums/services/permissions.service';
import { MailService } from '../notifications/mail/mail.service';
import { UserService } from '../ums/services';
import { LogisticsService } from '../logistics/logistics.service';

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
    ]),
    PassportModule,
    HttpModule,
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
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PermissionService,
    UserService,
    MailService, // Add MailService to providers
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    LogisticsService,
  ],
  exports: [
    AuthService,
    PermissionService,
    MailService, // Export if needed in other modules
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    JwtModule,
    MongooseModule,
  ],
})
export class AuthModule {}

