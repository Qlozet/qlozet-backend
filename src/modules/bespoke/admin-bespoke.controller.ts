import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';

import { BespokeService } from './bespoke.service';

// Read-only admin surface over bespoke (dispute arbitration). No write access —
// pricing/acceptance stay the vendor's/customer's decision.
@Controller('admin/bespoke')
@ApiTags('Admin — Bespoke')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class AdminBespokeController {
  constructor(private readonly bespokeService: BespokeService) {}

  @Get('quotes')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'List bespoke quotes (admin, read-only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'business_id', required: false, type: String })
  @ApiQuery({ name: 'customer_id', required: false, type: String })
  async listQuotes(
    @Query('page') page?: number,
    @Query('size') size?: number,
    @Query('status') status?: string,
    @Query('business_id') business_id?: string,
    @Query('customer_id') customer_id?: string,
  ) {
    return this.bespokeService.adminListQuotes({
      page,
      size,
      status,
      business_id,
      customer_id,
    });
  }

  @Get('quotes/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Get a bespoke quote with design + business + customer (admin)',
  })
  @ApiParam({ name: 'id', description: 'Quote ID' })
  async getQuote(@Param('id') id: string) {
    return this.bespokeService.adminGetQuote(id);
  }

  @Get('designs/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Get a bespoke design (admin, read-only)' })
  @ApiParam({ name: 'id', description: 'Design ID' })
  async getDesign(@Param('id') id: string) {
    return this.bespokeService.adminGetDesign(id);
  }
}
