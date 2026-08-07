import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { MessagingService } from './messaging.service';

// Order-scoped customer <-> tailor thread. No @Roles: the service authorises by
// participation (the order's customer, or the tailor's business). Bespoke only.
@Controller('orders')
@ApiTags('Order Messages')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class OrderMessagesController {
  constructor(private readonly messaging: MessagingService) {}

  @Get(':reference/messages')
  @ApiOperation({ summary: 'Get the message thread for a bespoke order' })
  @ApiParam({ name: 'reference', description: 'Order reference' })
  async list(@Param('reference') reference: string, @Req() req: any) {
    return this.messaging.listMessages(reference, req);
  }

  @Post(':reference/messages')
  @ApiOperation({ summary: 'Send a message on a bespoke order (in production/transit)' })
  @ApiParam({ name: 'reference', description: 'Order reference' })
  async send(
    @Param('reference') reference: string,
    @Body() body: { content?: string },
    @Req() req: any,
  ) {
    return this.messaging.sendMessage(reference, req, body?.content);
  }
}
