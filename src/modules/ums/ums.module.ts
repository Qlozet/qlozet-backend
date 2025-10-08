import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { RolesService, UserService } from './services';
import { PermissionService } from './services/permissions.service';
import { Role } from './schemas';
import { MongooseModule } from '@nestjs/mongoose';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import { RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';
import { SeedService } from './services/seed.service';
import { Business, BusinessSchema } from './schemas/business.schema';
import { MailService } from '../notifications/mail/mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [
    RolesService,
    PermissionService,
    SeedService,
    UserService,
    MailService,
  ],
  exports: [RolesService, PermissionService, SeedService, UserService],
})
export class UmsModule {}
