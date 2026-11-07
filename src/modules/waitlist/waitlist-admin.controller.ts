import { Controller, Delete, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas/user.schema';
import { WaitlistService } from './waitlist.service';

/**
 * The waitlist for the admin console. Staff only, and a customers page in the
 * permission grid (common/access/console-access.ts): these are people's
 * contact details.
 */
@ApiTags('Waitlist')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserType.PLATFORM)
@Controller('admin/waitlist')
export class WaitlistAdminController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @ApiOperation({
    summary: 'The waitlist, newest first, with totals',
    description:
      'Rows carry `signed_up`: true once someone with that email made an account of the same type. Totals cover the whole list, not the filter.',
  })
  @ApiQuery({ name: 'type', required: false, enum: ['all', 'customer', 'vendor'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'show', required: false, enum: ['people', 'bots'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  async list(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('show') show?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.waitlistService.adminList({
      type,
      search,
      show,
      page: Number(page),
      size: Number(size),
    });
  }

  @Get('export')
  @ApiOperation({ summary: 'The waitlist (same filter) as a CSV download' })
  async export(
    @Res() res: Response,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('show') show?: string,
  ) {
    const csv = await this.waitlistService.adminExportCsv({ type, search, show });
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="qlozet-waitlist-${day}.csv"`);
    res.send(csv);
  }

  @Delete('bots')
  @ApiOperation({ summary: 'Delete every likely-bot entry (customers delete permission)' })
  async deleteBots() {
    return this.waitlistService.adminDeleteBots();
  }
}
