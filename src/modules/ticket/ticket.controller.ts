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
  AssignTicketDto,
  TicketFilterDto,
} from './dto/ticket.dto';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import {
  CreateTicketReplyDto,
  TicketReplyResponseDto,
} from './dto/ticket-reply.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';

@ApiTags('Tickets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Roles(UserType.VENDOR)
  @Post()
  @ApiOperation({ summary: 'Vendor creates a ticket' })
  async create(@Req() req, @Body() dto: CreateTicketDto) {
    const business = req.business.id;
    return this.ticketService.create(business, dto);
  }

  @Roles(UserType.VENDOR)
  @Get('tickets')
  @ApiOperation({ summary: 'Get paginated tickets with filters' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async findAll(
    @Query() filters: TicketFilterDto,
    @Query('page') page: number = 1,
    @Query('size') size: number = 10,
    @Req() req: any,
  ) {
    return this.ticketService.findAll(filters, page, size, req?.business?.id);
  }
  @Roles(UserType.VENDOR)
  @Get(':id')
  @ApiOperation({ summary: 'Get a single ticket' })
  findOne(@Param('id') id: string) {
    return this.ticketService.findOne(id);
  }

  @Roles(UserType.VENDOR)
  @Patch(':id')
  @ApiOperation({ summary: 'Update ticket' })
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketService.update(id, dto);
  }
}
