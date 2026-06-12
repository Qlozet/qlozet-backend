import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RolesService, UserService } from './services';
import { PermissionService } from './services/permissions.service';
import { SeedService } from './services/seed.service';
import { MailService } from '../notifications/mail/mail.service';
import { UserController } from './users.controller';
import { TeamService } from './services/team.service';
import { JwtService } from '@nestjs/jwt';

// Import modules instead of directly listing foreign services
import { LogisticsModule } from '../logistics/logistics.module';
import { ProductModule } from '../products/products.module';

import { User, UserSchema } from './schemas/user.schema';
import { Address, AddressSchema } from './schemas/address.schema';
import { TeamMember, TeamMemberSchema } from './schemas/team.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Address.name, schema: AddressSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
    LogisticsModule,   // provides LogisticsService (needed by UserService)
    ProductModule,     // provides ProductService
  ],
  controllers: [UserController],
  providers: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    MailService,
    JwtService,
  ],
  exports: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    MailService,
    JwtService,
    MongooseModule,
  ],
})
export class UmsModule {}
