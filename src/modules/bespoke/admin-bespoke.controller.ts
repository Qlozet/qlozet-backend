import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';

import { BespokeService } from './bespoke.service';

// Admin surface over bespoke: read-only for quotes/designs (dispute
// arbitration — pricing/acceptance stay the vendor's/customer's decision),
// plus full CRUD on platform design templates.
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

  // ════════════════════════════════════════════════════════════════
  //  TEMPLATES — platform-curated studio starting points
  // ════════════════════════════════════════════════════════════════

  @Get('templates')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'List all design templates (active + inactive)' })
  async listTemplates() {
    return this.bespokeService.adminListTemplates();
  }

  @Get('templates/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Get one design template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async getTemplate(@Param('id') id: string) {
    return this.bespokeService.adminGetTemplate(id);
  }

  @Post('templates')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Create a design template' })
  async createTemplate(@Body() dto: any, @Req() req: any) {
    return this.bespokeService.adminCreateTemplate(dto, req.user?.id);
  }

  @Patch('templates/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Update a design template (fields or status)' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async updateTemplate(@Param('id') id: string, @Body() dto: any) {
    return this.bespokeService.adminUpdateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Delete a design template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  async deleteTemplate(@Param('id') id: string) {
    return this.bespokeService.adminDeleteTemplate(id);
  }
}
