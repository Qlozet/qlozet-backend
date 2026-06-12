import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RolesService, UserService } from './services';
import { PermissionService } from './services/permissions.service';
import { SeedService } from './services/seed.service';
import { MailService } from '../notifications/mail/mail.service';
import { UserController } from './users.controller';
import { ProductModule } from '../products/products.module';
import { TeamService } from './services/team.service';
import { JwtService } from '@nestjs/jwt';
import { BusinessService } from '../business/business.service';
import { OrdersModule } from '../orders/orders.module';
import { LogisticsService } from '../logistics/logistics.service';
import { HttpModule } from '@nestjs/axios';
import { TicketService } from '../ticket/ticket.service';
import { PlatformService } from '../platform/platform.service';
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
    OrdersModule,
    HttpModule,
    ProductModule,
  ],
  controllers: [UserController],
  providers: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    MailService,
    TeamService,
    JwtService,
    BusinessService,
    LogisticsService,
    TicketService,
    PlatformService,
  ],
  exports: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    MailService,
    TeamService,
    JwtService,
    BusinessService,
    LogisticsService,
    TicketService,
    PlatformService,
    MongooseModule,
  ],
})
export class UmsModule {}

