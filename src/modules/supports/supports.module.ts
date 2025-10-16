import { Module } from '@nestjs/common';
import { SupportController } from './supports.controller';
import { SupportService } from './supports.service';
import { ZohoToken, ZohoTokenSchema } from './schema/zoho-token.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { Support, SupportSchema } from './schema/support.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { JwtService } from '@nestjs/jwt';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ZohoToken.name, schema: ZohoTokenSchema },
      { name: Support.name, schema: SupportSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
  ],
  controllers: [SupportController],
  providers: [SupportService, JwtService],
})
export class SupportsModule {}
