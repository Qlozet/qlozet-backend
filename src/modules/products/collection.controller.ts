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
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { Collection } from './schemas/collection.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import { CreateCollectionDto } from './dto/collection.dto';

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
  @ApiResponse({ status: 201, type: Collection })
  async create(
    @Body() dto: CreateCollectionDto,
    @Req() req: any,
  ): Promise<Collection> {
    return this.collectionService.create(dto, req.business.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all collections' })
  async findAll(): Promise<Collection[]> {
    return this.collectionService.findAll();
  }

  @Get('vendor')
  @ApiOperation({ summary: 'Get collections by vendor' })
  async findByVendor(@Req() req: any): Promise<Collection[]> {
    return this.collectionService.findByVendor(req.user.id);
  }

  @Get(':collectionId/products')
  @ApiOperation({ summary: 'Get products under a collection' })
  async getProductsByCollection(@Param('collectionId') collectionId: string) {
    return this.collectionService.getProductsByCollection(collectionId);
  }
  @Get(':collectionId')
  @ApiOperation({ summary: 'Get collection by ID' })
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
