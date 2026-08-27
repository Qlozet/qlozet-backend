import {
  Body,
  Controller,
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
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { ProductService } from './products.service';
import { ProductModerationStatus } from './enums/product-moderation.enum';
import {
  AdminFindProductsDto,
  AdminModerateProductDto,
  AdminScheduleActivationDto,
  AdminUpdateProductDto,
  AdminUpdateProductStatusDto,
} from './dto/admin-products.dto';

/**
 * The admin catalogue surface.
 *
 * `GET /products` is the customer storefront: it forces status=active and
 * hides unapproved vendors, so a moderator browsing through it sees a
 * catalogue with no drafts, no archived items and nothing to moderate. These
 * routes read the collection unfiltered and carry the moderation actions the
 * admin product table offers.
 */
@ApiTags('Admin — Products')
@ApiBearerAuth('access-token')
@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdminProductsController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'List every product for moderation (admin)',
    description:
      'Unlike GET /products this returns products in any status, from any vendor, with the full filter set the admin catalogue table offers.',
  })
  async list(@Query() query: AdminFindProductsDto) {
    return this.productService.adminFindAll(query);
  }

  @Get('stats')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Catalogue metrics for the admin product pages (admin)',
    description:
      'Status and moderation counts for the current filter, plus a sales-by-category breakdown for the header donut.',
  })
  async stats(@Query() query: AdminFindProductsDto) {
    return this.productService.adminStats(query);
  }

  @Get('filters')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Filter values present in the catalogue (admin)',
    description:
      'Product types, categories, audiences, tags and vendors read from the data itself, so the Filter By menu never offers an option that returns nothing.',
  })
  @ApiQuery({ name: 'kind', required: false, type: String })
  async filters(@Query('kind') kind?: string) {
    return this.productService.adminFilterOptions(kind);
  }

  @Get(':product_id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Get one product for moderation (admin)',
    description:
      'GET /products/{id} is the customer PDP and 404s on anything not live from an approved vendor — exactly the products an admin needs to open. This returns any product, in any status, with its vendor and computed availability.',
  })
  @ApiParam({ name: 'product_id', description: 'Product ID' })
  async getOne(@Param('product_id') productId: string) {
    return this.productService.adminFindOne(productId);
  }

  @Patch(':product_id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Edit a product (admin)',
    description:
      'Partial update. Only the keys sent are written, and only the kind sub-document matching the product is applied. Editing a rejected listing returns it to the review queue.',
  })
  @ApiParam({ name: 'product_id', description: 'Product ID' })
  async update(
    @Param('product_id') productId: string,
    @Body() dto: AdminUpdateProductDto,
  ) {
    return this.productService.adminUpdate(productId, dto);
  }

  @Patch(':product_id/status')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Activate / deactivate / archive a product (admin)' })
  @ApiParam({ name: 'product_id', description: 'Product ID' })
  async updateStatus(
    @Param('product_id') productId: string,
    @Body() dto: AdminUpdateProductStatusDto,
  ) {
    return this.productService.adminUpdateStatus(
      productId,
      dto.status,
      dto.reason,
    );
  }

  @Patch(':product_id/schedule-activation')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Schedule a product to go live automatically (admin)' })
  @ApiParam({ name: 'product_id', description: 'Product ID' })
  async scheduleActivation(
    @Param('product_id') productId: string,
    @Body() dto: AdminScheduleActivationDto,
  ) {
    return this.productService.adminScheduleActivation(
      productId,
      new Date(dto.activation_date),
    );
  }

  @Post(':product_id/approve')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Approve a product listing (admin)' })
  @ApiParam({ name: 'product_id', description: 'Product ID' })
  async approve(
    @Param('product_id') productId: string,
    @Body() dto: AdminModerateProductDto,
    @Req() req: any,
  ) {
    return this.productService.adminModerate(
      productId,
      ProductModerationStatus.APPROVED,
      req.user?.id,
      dto?.reason,
    );
  }

  @Post(':product_id/reject')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Reject a product listing (admin)',
    description:
      'Flags the listing and pulls it out of the customer catalogue. Nothing is deleted — the vendor can fix it and resubmit. A reason is required.',
  })
  @ApiParam({ name: 'product_id', description: 'Product ID' })
  async reject(
    @Param('product_id') productId: string,
    @Body() dto: AdminModerateProductDto,
    @Req() req: any,
  ) {
    return this.productService.adminModerate(
      productId,
      ProductModerationStatus.REJECTED,
      req.user?.id,
      dto?.reason,
    );
  }
}
