import {
  Controller,
  Get,
  Param,
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
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { MessagingService } from './messaging.service';

// Admin read/escalation view of an order's message thread.
@Controller('admin/orders')
@ApiTags('Admin — Order Messages')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class AdminOrderMessagesController {
  constructor(private readonly messaging: MessagingService) {}

  @Get(':reference/messages')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Read an order message thread (admin, read-only)' })
  @ApiParam({ name: 'reference', description: 'Order reference' })
  async list(@Param('reference') reference: string) {
    return this.messaging.adminList(reference);
  }
}
