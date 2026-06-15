import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StyleLibraryService } from './style-library.service';
import {
  CreatePlatformStyleDto,
  UpdatePlatformStyleDto,
  QueryPlatformStyleDto,
  AddPlatformStylesDto,
} from './dto/platform-style.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';

@ApiTags('Style Library')
@ApiBearerAuth()
@Controller('style-library')
export class StyleLibraryController {
  constructor(private readonly service: StyleLibraryService) {}

  // ─── Admin Endpoints ───

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Create a platform style (admin only)' })
  create(@Body() dto: CreatePlatformStyleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Update a platform style (admin only)' })
  update(@Param('id') id: string, @Body() dto: UpdatePlatformStyleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate a platform style (admin only)' })
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }

  @Post('seed')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Seed default platform styles (admin only)' })
  seed() {
    return this.service.seed();
  }

  // ─── Vendor Endpoints ───

  @Post('add-to-product/:product_id')
  @UseGuards(RolesGuard)
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Add platform styles to a product (vendor only)' })
  addToProduct(
    @Param('product_id') productId: string,
    @Body() dto: AddPlatformStylesDto,
    @Req() req: any,
  ) {
    return this.service.addToProduct(
      productId,
      req.business._id.toString(),
      dto.platform_style_ids,
      dto.price_overrides,
    );
  }

  // ─── Public Endpoints (any authenticated user) ───

  @Get()
  @ApiOperation({ summary: 'Browse platform styles (filter by category/type/gender)' })
  findAll(@Query() query: QueryPlatformStyleDto) {
    return this.service.findAll(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List all style categories with counts' })
  getCategories() {
    return this.service.getCategories();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single platform style' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }
}
