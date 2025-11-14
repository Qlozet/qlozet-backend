import { Module } from '@nestjs/common';
import { RolesService, UserService } from './services';
import { PermissionService } from './services/permissions.service';
import { Role } from './schemas';
import { MongooseModule } from '@nestjs/mongoose';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import { RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';
import { SeedService } from './services/seed.service';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { MailService } from '../notifications/mail/mail.service';
import { UserController } from './users.controller';
import { Product, ProductSchema } from '../products/schemas';
import { ProductModule } from '../products/products.module';
import { TeamService } from './services/team.service';
import { TeamMember, TeamMemberSchema } from './schemas/team.schema';
import { JwtService } from '@nestjs/jwt';
import { Address, AddressSchema } from './schemas/address.schema';
import { AdminService } from './services/admin.service';
import { BusinessService } from '../business/business.service';
import {
  Warehouse,
  WarehouseSchema,
} from '../business/schemas/warehouse.schema';
import { AdminController } from './admin.controlller';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    OrdersModule,
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Product.name, schema: ProductSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    ProductModule,
  ],
  controllers: [UserController, AdminController],
  providers: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    TeamService,
    MailService,
    TeamService,
    JwtService,
    AdminService,
    BusinessService,
  ],
  exports: [RolesService, PermissionService, SeedService, UserService],
})
export class UmsModule {}
