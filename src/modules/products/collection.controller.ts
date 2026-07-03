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
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import {
  CreateCollectionDto,
  CreatePlatformCollectionDto,
  UpdateCollectionDto,
} from './dto/collection.dto';
import {
  CollectionResponseDto,
  CollectionProductsResponseDto,
  CollectionsWithProductsResponseDto,
} from './dto/collection-response.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Collections')
@ApiBearerAuth('access-token')
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  // ─────────────────────────────────────────────────────────
  // PUBLIC — Platform Collections (Homepage / Explore)
  // ─────────────────────────────────────────────────────────

  @Public()
  @Get('platform')
  @ApiOperation({
    summary: 'Get active platform collections (Public)',
    description: 'Returns active platform-wide collections for homepage/explore pages.',
  })
  @ApiOkResponse({ type: [CollectionResponseDto] })
  getPlatformCollections() {
    return this.collectionService.getPlatformCollections();
  }

  @Public()
  @Get('platform/:idOrSlug')
  @ApiOperation({
    summary: 'Get a platform collection with its products (Public)',
    description: 'Lookup by ID or slug. Returns the collection and paginated matched products.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Collection ID or slug' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getPlatformCollectionWithProducts(
    @Param('idOrSlug') idOrSlug: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.collectionService.getPlatformCollectionWithProducts(
      idOrSlug,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  // ─────────────────────────────────────────────────────────
  // VENDOR — Collection CRUD
  // ─────────────────────────────────────────────────────────

  @Post()
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new vendor collection' })
  @ApiCreatedResponse({ type: CollectionResponseDto })
  async create(@Body() dto: CreateCollectionDto, @Req() req: any) {
    return this.collectionService.create(dto, req.business.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all collections' })
  @ApiOkResponse({ type: [CollectionResponseDto] })
  async findAll() {
    return this.collectionService.findAll();
  }

  @Get('vendor')
  @ApiOperation({ summary: 'Get collections by vendor' })
  @ApiOkResponse({ type: [CollectionResponseDto] })
  async findByVendor(@Req() req: any) {
    return this.collectionService.findByVendor(req.user.id);
  }

  @Roles(UserType.VENDOR)
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by title or description' })
  @ApiQuery({ name: 'is_active', required: false, type: Boolean, example: true })
  @ApiQuery({ name: 'condition_match', required: false, enum: ['all', 'any'] })
  @Get('vendor/with-products')
  @ApiOperation({ summary: 'Get all vendor collections with their products' })
  @ApiOkResponse({ type: CollectionsWithProductsResponseDto })
  async getCollectionsWithProductsByVendor(
    @Query() query: any,
    @Req() req: any,
  ) {
    return this.collectionService.getCollectionsWithProductsByVendor(
      req.business?.id,
      query,
    );
  }

  @Get(':collectionId/products')
  @ApiOperation({ summary: 'Get products under a collection' })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiOkResponse({ type: CollectionProductsResponseDto })
  async getProductsByCollection(@Param('collectionId') collectionId: string) {
    return this.collectionService.getProductsByCollection(collectionId);
  }

  @Get(':collectionId')
  @ApiOperation({ summary: 'Get collection by ID' })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiOkResponse({ type: CollectionResponseDto })
  async getCollectionById(@Param('collectionId') collectionId: string) {
    return this.collectionService.getCollectionById(collectionId);
  }

  @Patch(':collectionId')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Update a vendor collection' })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiOkResponse({ type: CollectionResponseDto })
  async update(
    @Param('collectionId') collectionId: string,
    @Body() dto: UpdateCollectionDto,
    @Req() req: any,
  ) {
    return this.collectionService.update(collectionId, dto, req.business.id);
  }

  @Delete(':collectionId')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Delete a vendor collection' })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiOkResponse({ description: 'Collection deleted', schema: { properties: { deleted: { type: 'boolean' }, id: { type: 'string' } } } })
  async delete(
    @Param('collectionId') collectionId: string,
    @Req() req: any,
  ) {
    return this.collectionService.delete(collectionId, req.business.id);
  }

  @Post(':collectionId/include/:productId')
  @Roles(UserType.VENDOR)
  @ApiOperation({
    summary: 'Manually include a product in a collection',
    description: 'Force-adds a product to this collection, overriding the smart rules.',
  })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiParam({ name: 'productId', description: 'Product ID to include' })
  async includeProduct(
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
    @Req() req: any,
  ) {
    return this.collectionService.includeProduct(collectionId, productId, req.business.id);
  }

  @Post(':collectionId/exclude/:productId')
  @Roles(UserType.VENDOR)
  @ApiOperation({
    summary: 'Manually exclude a product from a collection',
    description: 'Force-removes a product from this collection, even if the rules say it should match.',
  })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiParam({ name: 'productId', description: 'Product ID to exclude' })
  async excludeProduct(
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
    @Req() req: any,
  ) {
    return this.collectionService.excludeProduct(collectionId, productId, req.business.id);
  }

  // ─────────────────────────────────────────────────────────
  // ADMIN — Platform Collection Management
  // ─────────────────────────────────────────────────────────

  @Post('admin/platform')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Create a platform-wide collection (Admin only)',
    description: 'Creates a collection visible on homepage/explore. Products are matched via conditions across all vendors.',
  })
  @ApiCreatedResponse({ type: CollectionResponseDto })
  async createPlatformCollection(@Body() dto: CreatePlatformCollectionDto) {
    return this.collectionService.createPlatformCollection(dto);
  }

  @Get('admin/platform')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Get all platform collections including inactive (Admin only)',
  })
  @ApiOkResponse({ type: [CollectionResponseDto] })
  async getAllPlatformCollections() {
    return this.collectionService.getAllPlatformCollections();
  }

  @Patch('admin/platform/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Update a platform collection (Admin only)' })
  @ApiParam({ name: 'id', description: 'Platform collection ID' })
  @ApiOkResponse({ type: CollectionResponseDto })
  async updatePlatformCollection(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collectionService.updatePlatformCollection(id, dto);
  }

  @Delete('admin/platform/:id')
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Delete a platform collection (Admin only)' })
  @ApiParam({ name: 'id', description: 'Platform collection ID' })
  @ApiOkResponse({ description: 'Platform collection deleted', schema: { properties: { deleted: { type: 'boolean' }, id: { type: 'string' } } } })
  async deletePlatformCollection(@Param('id') id: string) {
    return this.collectionService.deletePlatformCollection(id);
  }

  @Post('admin/platform/:id/include/:productId')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Manually include a product in a platform collection (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Platform collection ID' })
  @ApiParam({ name: 'productId', description: 'Product ID to include' })
  async includePlatformProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.collectionService.includeProduct(id, productId);
  }

  @Post('admin/platform/:id/exclude/:productId')
  @Roles(UserType.PLATFORM)
  @ApiOperation({
    summary: 'Manually exclude a product from a platform collection (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Platform collection ID' })
  @ApiParam({ name: 'productId', description: 'Product ID to exclude' })
  async excludePlatformProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.collectionService.excludeProduct(id, productId);
  }
}
