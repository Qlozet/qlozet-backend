import { Module } from '@nestjs/common';
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
import { DatabaseModule } from 'src/database/database.module';
import { EventsModule } from '../recommendations/events/events.module';

@Module({
  imports: [OrdersModule, HttpModule, DatabaseModule, ProductModule, EventsModule],
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
  ],
})
export class UmsModule { }
