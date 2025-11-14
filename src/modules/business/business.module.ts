import { Module } from '@nestjs/common';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { Warehouse, WarehouseSchema } from './schemas/warehouse.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';
import { Business, BusinessSchema } from './schemas/business.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: Role.name, schema: RoleSchema },
      { name: User.name, schema: UserSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
  ],
  controllers: [BusinessController],
  providers: [BusinessService, JwtService],
})
export class BusinessModule {}
