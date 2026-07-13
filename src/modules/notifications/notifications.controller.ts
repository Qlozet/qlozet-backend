import {
  Controller,
  Get,
  Patch,
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
import { JwtAuthGuard } from '../../common/guards';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

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
