import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { Ticket, TicketSchema } from './schema/ticket.schema';
import { TicketReply, TicketReplySchema } from './schema/reply-ticket.schema';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: TicketReply.name, schema: TicketReplySchema },
    ]),
  ],
  controllers: [TicketController],
  providers: [TicketService, JwtService],
})
export class TicketModule {}
