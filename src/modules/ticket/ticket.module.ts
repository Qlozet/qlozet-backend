import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { Ticket, TicketSchema } from './schema/ticket.schema';
import { TicketReply, TicketReplySchema } from './schema/reply-ticket.schema';
import {
  TicketActivity,
  TicketActivitySchema,
} from './schema/ticket-activity.schema';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: TicketReply.name, schema: TicketReplySchema },
      { name: TicketActivity.name, schema: TicketActivitySchema },
    ]),
  ],
  controllers: [TicketController],
  providers: [TicketService, JwtService],
  exports: [TicketService],
})
export class TicketModule {}
