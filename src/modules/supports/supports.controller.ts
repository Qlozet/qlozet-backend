import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { SupportService } from './supports.service';
import { GenerateCodeDto } from './dto/generate-code.dto';

@ApiTags('Supports')
@Controller('supports')
@ApiBearerAuth('access-token')
@ApiTags('SupportController')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}
  //   @UseGuards(AtGuard)
  @Public()
  @Post('')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'create ticket()' })
  @ApiOperation({
    summary: 'Create a new ticket',
    description: 'Creates a new support ticket in Zoho Desk.',
  })
  @ApiBody({ type: CreateTicketDto })
  @ApiResponse({
    status: 201,
    description: 'The ticket has been successfully created.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @ApiResponse({
    status: 500,
    description: 'Failed to create ticket in Zoho Desk.',
  })
  async createTicket(@Body() dto: CreateTicketDto) {
    const ticket = await this.supportService.createTicket(dto);
    return {
      message: 'Ticket created successfully',
      data: ticket,
    };
  }
  @Public()
  @Post('generate-code')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'generateCode()' })
  generateCode(@Body() dto: GenerateCodeDto) {
    return this.supportService.generateToken(dto.code);
  }
}
