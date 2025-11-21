import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RolesGuard,
} from '../../common/guards';
import { Permission } from '../ums/schemas';
import { PermissionSchema } from '../ums/schemas/permission.schema';
import { PermissionService } from '../ums/services/permissions.service';
import { MailService } from '../notifications/mail/mail.service';
import { UserService } from '../ums/services';
import { LogisticsService } from '../logistics/logistics.service';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    PassportModule,
    HttpModule,
    DatabaseModule,
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
  ],
})
export class AuthModule {}
