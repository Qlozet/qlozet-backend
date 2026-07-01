import {
  Controller,
  Get,
  Post,
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
import { CreateCollectionDto } from './dto/collection.dto';
import {
  CollectionResponseDto,
  CollectionProductsResponseDto,
  CollectionsWithProductsResponseDto,
} from './dto/collection-response.dto';

@ApiTags('Collections')
@ApiBearerAuth('access-token')
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Post()
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new product collection' })
  @ApiCreatedResponse({
    description: 'Collection created. Matching products are assigned in the background.',
    type: CollectionResponseDto,
  })
  async create(
    @Body() dto: CreateCollectionDto,
    @Req() req: any,
  ) {
    return this.collectionService.create(dto, req.business.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all collections' })
  @ApiOkResponse({
    description: 'Returns all collections across all vendors.',
    type: [CollectionResponseDto],
  })
  async findAll() {
    return this.collectionService.findAll();
  }

  @Get('vendor')
  @ApiOperation({ summary: 'Get collections by vendor' })
  @ApiOkResponse({
    description: 'Returns all collections owned by the authenticated vendor.',
    type: [CollectionResponseDto],
  })
  async findByVendor(@Req() req: any) {
    return this.collectionService.findByVendor(req.user.id);
  }

  @Get(':collectionId/products')
  @ApiOperation({ summary: 'Get products under a collection' })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiOkResponse({
    description: 'Returns paginated products belonging to this collection.',
    type: CollectionProductsResponseDto,
  })
  async getProductsByCollection(@Param('collectionId') collectionId: string) {
    return this.collectionService.getProductsByCollection(collectionId);
  }

  @Get(':collectionId')
  @ApiOperation({ summary: 'Get collection by ID' })
  @ApiParam({ name: 'collectionId', description: 'Collection ID' })
  @ApiOkResponse({
    description: 'Returns a single collection by its ID.',
    type: CollectionResponseDto,
  })
  async getCollectionById(@Param('collectionId') collectionId: string) {
    return this.collectionService.getCollectionById(collectionId);
  }

  @Roles(UserType.VENDOR)
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by collection title or description',
  })
  @ApiQuery({
    name: 'is_active',
    required: false,
    type: Boolean,
    example: true,
  })
  @ApiQuery({
    name: 'condition_match',
    required: false,
    enum: ['all', 'any'],
    description: 'Condition matching rule',
  })
  @Get('vendor/with-products')
  @ApiOperation({ summary: 'Get all vendor collections with their products' })
  @ApiOkResponse({
    description: 'Returns paginated collections, each with their matched products embedded.',
    type: CollectionsWithProductsResponseDto,
  })
  async getCollectionsWithProductsByVendor(
    @Query() query: any,
    @Req() req: any,
  ) {
    return this.collectionService.getCollectionsWithProductsByVendor(
      req.business?.id,
      query,
    );
  }
}
