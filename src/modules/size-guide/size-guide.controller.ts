import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { SizeGuideService } from './size-guide.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import { VendorRole } from '../ums/schemas/role.schema';
import { CreateSizeGuideDto } from './dto/create-size-guide.dto';
import { UpdateSizeGuideDto } from './dto/update-size-guide.dto';
import {
  RecommendSizeDto,
  RecommendSizeResponseDto,
} from './dto/recommend-size.dto';
import {
  SizeGuideResponseDto,
  SizeGuideForProductResponseDto,
} from './dto/size-guide-response.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Size Guides')
@ApiBearerAuth('access-token')
@Controller('size-guides')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class SizeGuideController {
  constructor(private readonly sizeGuideService: SizeGuideService) {}

  // ─────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────

  @Public()
  @Get('body-parts')
  @ApiOperation({ summary: 'Get supported body parts list' })
  getBodyParts() {
    return this.sizeGuideService.getBodyParts();
  }

  @Public()
  @Get('product/:productId')
  @ApiOperation({
    summary: 'Get size chart for a product (Public)',
    description:
      'Returns the size guide associated with a product, including sizes, body parts, and fit types.',
  })
  @ApiParam({ name: 'productId', description: 'Product ID' })
  @ApiOkResponse({ type: SizeGuideForProductResponseDto })
  getGuideForProduct(@Param('productId') productId: string) {
    return this.sizeGuideService.getGuideForProduct(productId);
  }

  // ─────────────────────────────────────────────────────────
  // CUSTOMER — Size Recommendation
  // ─────────────────────────────────────────────────────────

  @Post(':id/recommend')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({
    summary: 'Get size recommendation based on your measurements',
    description:
      'Uses the logged-in customer\'s active measurement set to recommend a size. ' +
      'Optionally specify a fit type to see garment measurements with ease.',
  })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  @ApiOkResponse({ type: RecommendSizeResponseDto })
  recommendSize(
    @Param('id') id: string,
    @Body() dto: RecommendSizeDto,
    @Req() req: any,
  ) {
    return this.sizeGuideService.recommendSize(id, req.user.id, dto);
  }

  @Get('fits-me')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({
    summary: 'Find clothes that fit me',
    description: 'Matches the logged-in customer\'s measurements against vendor size guides to find products that actually fit.',
  })
  @ApiOkResponse({ description: 'Products that fit the user' })
  findProductsThatFit(@Req() req: any) {
    return this.sizeGuideService.findProductsThatFit(req.user.id);
  }

  // ─────────────────────────────────────────────────────────
  // VENDOR — CRUD
  // ─────────────────────────────────────────────────────────

  @Post()
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS, VendorRole.TAILOR)
  @ApiOperation({ summary: 'Create a new size guide' })
  @ApiCreatedResponse({ type: SizeGuideResponseDto })
  create(@Body() dto: CreateSizeGuideDto, @Req() req: any) {
    return this.sizeGuideService.create(dto, req.business.id);
  }

  @Get()
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get all size guides for your business' })
  @ApiOkResponse({ type: [SizeGuideResponseDto] })
  findAll(@Req() req: any) {
    return this.sizeGuideService.findAll(req.business.id);
  }

  @Get(':id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get a size guide by ID' })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  @ApiOkResponse({ type: SizeGuideResponseDto })
  findById(@Param('id') id: string, @Req() req: any) {
    return this.sizeGuideService.findById(id, req.business.id);
  }

  @Patch(':id')
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS, VendorRole.TAILOR)
  @ApiOperation({ summary: 'Update a size guide' })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  @ApiOkResponse({ type: SizeGuideResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSizeGuideDto,
    @Req() req: any,
  ) {
    return this.sizeGuideService.update(id, dto, req.business.id);
  }

  @Delete(':id')
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @ApiOperation({
    summary: 'Delete a size guide and remove it from all products',
  })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  delete(@Param('id') id: string, @Req() req: any) {
    return this.sizeGuideService.delete(id, req.business.id);
  }

  // ─────────────────────────────────────────────────────────
  // VENDOR — Manual Overrides
  // ─────────────────────────────────────────────────────────

  @Post(':id/include/:productId')
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @ApiOperation({
    summary: 'Manually include a product in a size guide',
    description:
      'Force-assigns this size guide to a product, overriding the condition rules.',
  })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  @ApiParam({ name: 'productId', description: 'Product ID to include' })
  includeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Req() req: any,
  ) {
    return this.sizeGuideService.includeProduct(id, productId, req.business.id);
  }

  @Post(':id/exclude/:productId')
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @ApiOperation({
    summary: 'Manually exclude a product from a size guide',
    description:
      'Prevents this size guide from being applied to a product, even if conditions match.',
  })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  @ApiParam({ name: 'productId', description: 'Product ID to exclude' })
  excludeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Req() req: any,
  ) {
    return this.sizeGuideService.excludeProduct(
      id,
      productId,
      req.business.id,
    );
  }

  // ─────────────────────────────────────────────────────────
  // VENDOR — Manual Sync
  // ─────────────────────────────────────────────────────────

  @Post('apply/:id')
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @ApiOperation({
    summary: 'Manually trigger size guide application to matching products',
  })
  @ApiParam({ name: 'id', description: 'Size Guide ID' })
  applyGuide(@Param('id') id: string, @Req() req: any) {
    return this.sizeGuideService.applyGuide(id, req.business.id);
  }
}
