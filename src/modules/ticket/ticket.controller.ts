import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  UseGuards,
  Req,
  ValidationPipe,
  UsePipes,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiCreatedResponse,
} from '@nestjs/swagger';

import { TicketService } from './ticket.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  TicketFilterDto,
} from './dto/ticket.dto';
import { CreateTicketReplyDto } from './dto/ticket-reply.dto';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';

@ApiTags('Tickets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  // Dual vendor/customer route: vendors raise business tickets, customers
  // raise personal ones (the shop Help Center's "Contact support").
  @Roles(UserType.VENDOR, UserType.CUSTOMER)
  @Post()
  @ApiOperation({ summary: 'Create a support ticket (vendor or customer)' })
  async create(@Req() req, @Body() dto: CreateTicketDto) {
    if (req.business?.id) {
      return this.ticketService.create(req.business.id, dto);
    }
    return this.ticketService.createForCustomer(req.user?.id, dto);
  }

  @Roles(UserType.VENDOR, UserType.CUSTOMER)
  @Get()
  @ApiOperation({ summary: 'Get paginated tickets (own scope)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async findAll(
    @Query() filters: TicketFilterDto,
    @Query('page') page: number = 1,
    @Query('size') size: number = 10,
    @Req() req: any,
  ) {
    if (!req?.business?.id) {
      return this.ticketService.customerTickets(req.user?.id, page, size);
    }
    return this.ticketService.findAll(filters, page, size, req?.business?.id);
  }
  @Roles(UserType.VENDOR, UserType.CUSTOMER)
  @Get(':id')
  @ApiOperation({ summary: 'Get a single ticket (customers: own only)' })
  findOne(@Param('id') id: string, @Req() req: any) {
    if (!req?.business?.id) {
      return this.ticketService.customerTicket(id, req.user?.id);
    }
    return this.ticketService.findOne(id);
  }

  // Originator reply — vendors on their business tickets, customers on
  // their personal ones. Admin replies stay on the platform routes.
  @Roles(UserType.VENDOR, UserType.CUSTOMER)
  @Post(':id/replies')
  @ApiOperation({ summary: 'Reply to your own ticket' })
  async reply(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: CreateTicketReplyDto,
  ) {
    return this.ticketService.ownerReply(id, req.user?.id, dto, {
      customerId: req.business?.id ? undefined : req.user?.id,
      businessId: req.business?.id,
    });
  }

  @Roles(UserType.VENDOR)
  @Patch(':id')
  @ApiOperation({ summary: 'Update ticket' })
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketService.update(id, dto);
  }
}
