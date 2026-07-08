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
import { UserService } from '../ums/services/users.service';
import {
  CreatePlatformStyleDto,
  UpdatePlatformStyleDto,
  QueryPlatformStyleDto,
  AddPlatformStylesDto,
} from './dto/platform-style.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import { VendorRole } from '../ums/schemas/role.schema';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Style Library')
@ApiBearerAuth('access-token')
@Controller('style-library')
export class StyleLibraryController {
  constructor(
    private readonly service: StyleLibraryService,
    private readonly userService: UserService
  ) {}

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

  @Post('regenerate-images')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Generate images for styles missing them (admin only)' })
  regenerateImages() {
    return this.service.regenerateImages();
  }

  // ─── Vendor Endpoints ───

  @Post('add-to-product/:product_id')
  @UseGuards(RolesGuard)
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS, VendorRole.TAILOR)
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

  // ─── Vendor Custom Styles Endpoints ───

  @Post('vendor')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS, VendorRole.TAILOR)
  @ApiOperation({ summary: 'Create a custom style for the vendor' })
  createVendorStyle(@Body() dto: CreatePlatformStyleDto, @Req() req: any) {
    return this.service.createVendorStyle(dto, req.business._id.toString());
  }

  @Patch('vendor/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS, VendorRole.TAILOR)
  @ApiOperation({ summary: 'Update a vendor custom style' })
  updateVendorStyle(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformStyleDto,
    @Req() req: any,
  ) {
    return this.service.updateVendorStyle(id, dto, req.business._id.toString());
  }

  @Delete('vendor/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @ApiOperation({ summary: 'Deactivate a vendor custom style' })
  deactivateVendorStyle(@Param('id') id: string, @Req() req: any) {
    return this.service.deactivateVendorStyle(id, req.business._id.toString());
  }

  // ─── Public Endpoints (any authenticated user) ───

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Browse platform styles (and custom styles if vendor)' })
  async findAll(@Query() query: QueryPlatformStyleDto, @Req() req: any) {
    let businessId: string | undefined = undefined;
    if (req.user?.id) {
      try {
        const user = await this.userService.findById(req.user.id);
        if (user && user.type === UserType.VENDOR && user.business) {
          // Mongoose populate might make business an object, or it might just be the ID
          businessId = (user.business as any)._id?.toString() || user.business.toString();
        }
      } catch (e) {
        // Ignore user not found error for token
      }
    }
    return this.service.findAll(query, businessId);
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
