import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/broadcast.dto';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas/user.schema';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly broadcasts: BroadcastsService,
  ) {}

  // ─── Admin announcements ────────────────────────────────────────────
  // Declared before the :id routes so the literal path reads first.
  //
  // These replaced a settings grid that let an admin toggle individual
  // notification types per channel. It persisted nothing, and most of what it
  // offered should never have been switchable — a shipping notice is an
  // obligation, not a preference. The thing that was actually missing was the
  // ability to tell everyone something.

  @Post('broadcasts')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Send or schedule an announcement to a whole audience (Admin)',
    description:
      'Creates the record and returns immediately; the fan-out runs in the ' +
      'background. Poll the list endpoint for progress counters.',
  })
  async createBroadcast(@Body() dto: CreateBroadcastDto, @Req() req: any) {
    return this.broadcasts.create(dto, {
      id: req.user.id,
      name: req.user.full_name || req.user.first_name,
    });
  }

  @Get('broadcasts')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Announcement history, newest first (Admin)' })
  async listBroadcasts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.broadcasts.list(Number(page) || 1, Number(limit) || 20);
  }

  @Patch('broadcasts/:id/cancel')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Cancel a scheduled announcement before it sends (Admin)',
  })
  async cancelBroadcast(@Param('id') id: string) {
    return this.broadcasts.cancel(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated notifications for the logged-in user' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['order', 'shipping', 'payment', 'bespoke', 'product', 'team', 'system'],
    description: 'Filter by notification category',
  })
  async getNotifications(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ) {
    const userId = req.user.id || req.user._id;
    const result = await this.notificationsService.getForUser(userId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      category,
    });

    return {
      success: true,
      message: 'Notifications fetched successfully',
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count (total + per category)' })
  async getUnreadCount(@Req() req: any) {
    const userId = req.user.id || req.user._id;
    const counts = await this.notificationsService.getUnreadCount(userId);

    return {
      success: true,
      message: 'Unread count fetched',
      data: counts,
    };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id || req.user._id;
    const notification = await this.notificationsService.markAsRead(id, userId);

    return {
      success: true,
      message: 'Notification marked as read',
      data: notification,
    };
  }

  @Patch('mark-all-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@Req() req: any) {
    const userId = req.user.id || req.user._id;
    const result = await this.notificationsService.markAllAsRead(userId);

    return {
      success: true,
      message: result.message,
      data: null,
    };
  }
}
