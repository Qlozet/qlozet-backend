import { Module } from '@nestjs/common';
import { TransactionController } from './transactions.controller';
import { TransactionService } from './transactions.service';
import { Transaction, TransactionSchema } from './schema/transaction.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
  ],
  controllers: [TransactionController],
  providers: [TransactionService, JwtService],
})
export class TransactionsModule {}
