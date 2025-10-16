import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
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
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { VendorRole } from '../ums/schemas';

@ApiTags('Supports')
@Controller('supports')
@ApiBearerAuth('access-token')
@ApiTags('SupportController')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class SupportController {
  constructor(private readonly supportService: SupportService) {}
  //   @UseGuards(AtGuard)
  @Post('')
  @Roles(VendorRole.OWNER, VendorRole.CUSTOMER_SUPPORT)
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
  async createTicket(@Body() dto: CreateTicketDto, @Req() req: any) {
    const ticket = await this.supportService.createTicket(
      dto,
      req.business._id,
    );
    return {
      message: 'Ticket created successfully',
      data: ticket,
    };
  }
  @Roles(VendorRole.OWNER, VendorRole.CUSTOMER_SUPPORT)
  @Get('business')
  @ApiOperation({ summary: 'Get all support tickets for a business' })
  async getTicketsByBusiness(@Req() req: any) {
    return this.supportService.getTicketsByBusiness(req.business._id);
  }
  @Public()
  @Post('generate-code')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'generateCode()' })
  generateCode(@Body() dto: GenerateCodeDto) {
    return this.supportService.generateToken(dto.code);
  }
}
