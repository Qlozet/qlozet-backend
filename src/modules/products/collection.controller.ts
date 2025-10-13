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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { Collection } from './schemas/collection.schema';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
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
    return this.collectionService.create(dto, req.user.id);
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

  @Get('vendor/with-products')
  @ApiOperation({ summary: 'Get all vendor collections with their products' })
  async getCollectionsWithProductsByVendor(@Req() req: any) {
    return this.collectionService.getCollectionsWithProductsByVendor(
      req.user.id,
    );
  }
}
