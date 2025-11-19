import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { Ticket, TicketSchema } from './schema/ticket.schema';
import { User } from '../ums/schemas';
import { UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { TicketReply, TicketReplySchema } from './schema/reply-ticket.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: TicketReply.name, schema: TicketReplySchema },
    ]),
  ],
  controllers: [TicketController],
  providers: [TicketService, JwtService],
})
export class TicketModule {}
