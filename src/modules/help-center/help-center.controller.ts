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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { UserType } from '../ums/schemas';
import { HelpCenterService } from './help-center.service';

@ApiTags('Help Center')
@ApiBearerAuth('access-token')
@Controller('help')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HelpCenterController {
  constructor(private readonly helpService: HelpCenterService) {}

  // ── Public — shop (customer) and vendor console ──

  @Public()
  @Get('articles')
  @ApiOperation({
    summary:
      'Published help articles for an audience (customer|vendor), optional search',
  })
  async list(
    @Query('audience') audience?: string,
    @Query('search') search?: string,
  ) {
    return this.helpService.listPublic(
      audience === 'vendor' ? 'vendor' : 'customer',
      search,
    );
  }

  @Public()
  @Get('articles/:id')
  @ApiOperation({ summary: 'One published article (counts the view)' })
  async get(@Param('id') id: string) {
    return this.helpService.getPublic(id);
  }

  @Public()
  @Post('articles/:id/feedback')
  @ApiOperation({ summary: '"Was this helpful?" vote' })
  async feedback(@Param('id') id: string, @Body('helpful') helpful: any) {
    return this.helpService.feedback(id, helpful === true || helpful === 'true');
  }

  // ── Admin CRUD ──

  @Roles(UserType.PLATFORM)
  @Get('admin/articles')
  @ApiOperation({ summary: 'All help articles incl. drafts (admin)' })
  async adminList() {
    return this.helpService.adminList();
  }

  @Roles(UserType.PLATFORM)
  @Get('admin/articles/:id')
  @ApiOperation({ summary: 'One article, raw body (admin)' })
  async adminGet(@Param('id') id: string) {
    return this.helpService.adminGet(id);
  }

  @Roles(UserType.PLATFORM)
  @Post('admin/articles')
  @ApiOperation({ summary: 'Create a help article (admin)' })
  async adminCreate(@Body() dto: any, @Req() req: any) {
    return this.helpService.adminCreate(dto, req.user?.id);
  }

  @Roles(UserType.PLATFORM)
  @Patch('admin/articles/:id')
  @ApiOperation({ summary: 'Update a help article (admin)' })
  async adminUpdate(@Param('id') id: string, @Body() dto: any) {
    return this.helpService.adminUpdate(id, dto);
  }

  @Roles(UserType.PLATFORM)
  @Delete('admin/articles/:id')
  @ApiOperation({ summary: 'Delete a help article (admin)' })
  async adminDelete(@Param('id') id: string) {
    return this.helpService.adminDelete(id);
  }
}
