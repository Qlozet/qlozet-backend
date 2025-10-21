import { ProductDocument } from './schemas';
import {
  Controller,
  Post,
  Body,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
  Get,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  CreateAccessoryDto,
  CreateClothingDto,
  CreateFabricDto,
} from './dto/product.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import { ProductService } from './products.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';

@ApiTags('Products')
@ApiBearerAuth('access-token')
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class ProductsController {
  constructor(private readonly productService: ProductService) {}

  // ---------------- CLOTHING ----------------
  @Post('clothing')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new clothing product' })
  @ApiResponse({ status: 201, description: 'Clothing product created' })
  async createClothing(
    @Body() clothingDto: CreateClothingDto,
    @Req() req: any,
  ) {
    return this.productService.create(clothingDto, req.user.id, 'clothing');
  }

  // ---------------- FABRIC ----------------
  @Post('fabric')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new fabric product' })
  @ApiResponse({ status: 201, description: 'Fabric product created' })
  async createFabric(@Body() fabricDto: CreateFabricDto, @Req() req: any) {
    return this.productService.create(fabricDto, req.user.id, 'fabric');
  }

  // ---------------- ACCESSORY ----------------
  @Post('accessory')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new accessory product' })
  @ApiResponse({ status: 201, description: 'Accessory product created' })
  async createAccessory(
    @Body() accessoryDto: CreateAccessoryDto,
    @Req() req: any,
  ) {
    return this.productService.create(accessoryDto, req.user.id, 'accessory');
  }
  @Get()
  @Roles(UserType.VENDOR)
  @ApiOperation({
    summary: 'Get all products with pagination and optional filters/search',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number',
    type: Number,
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Number of items per page',
    type: Number,
  })
  @ApiQuery({
    name: 'kind',
    required: false,
    description: 'Filter by product kind (clothing, accessory, fabric)',
    type: String,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by product name or title',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of products',
  })
  async findAll(
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
  ) {
    return this.productService.findAll(
      Number(page),
      Number(size),
      kind,
      search,
    );
  }
  @Get('by-vendor')
  @ApiOperation({
    summary:
      'Get all products by vendor with optional kind filter and pagination',
  })
  @ApiQuery({
    name: 'kind',
    required: false,
    description: 'Filter by product kind (clothing, fabric, accessory)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number',
    type: Number,
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Page size',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of products',
    type: Object,
  })
  async findByVendor(
    @Req() req: any,
    @Query('kind') kind: string,
    @Query('page') page = 1,
    @Query('size') size = 10,
  ) {
    return this.productService.findByVendor(
      req.user.id,
      kind,
      Number(page),
      Number(size),
    );
  }
  @Get(':id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({
    status: 200,
    description: 'Product found',
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findById(@Param('id') id: string) {
    return this.productService.findById(id);
  }

  @Delete(':id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Delete a product by ID' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product deleted successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async delete(@Param('id') id: string, @Req() req: any) {
    await this.productService.delete(id, req.user.id);
    return { message: 'Product deleted successfully' };
  }
}
