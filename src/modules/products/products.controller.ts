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
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';
import {
  CreateAccessoryDto,
  CreateClothingDto,
  CreateFabricDto,
  ProductListResponseDto,
} from './dto/product.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import { ProductService } from './products.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RateProductDto } from './dto/rate-product.dto';
import { FindAllProductsDto } from './dto/find-all-products.dto';
import {
  ScheduleActivationDto,
  UpdateStatusDto,
} from './dto/update-status.dto';
import { UpdateAccessoryVariantStockDto } from './dto/accessory.dto';
import { Types } from 'mongoose';
import { FabricParamDto, UpdateFabricStockDto } from './dto/fabric.dto';

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
    return this.productService.upsert(
      clothingDto,
      req.business?.id,
      'clothing',
    );
  }

  // ---------------- FABRIC ----------------
  @Post('fabric')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new fabric product' })
  @ApiResponse({ status: 201, description: 'Fabric product created' })
  async createFabric(@Body() fabricDto: CreateFabricDto, @Req() req: any) {
    return this.productService.upsert(fabricDto, req.business?.id, 'fabric');
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
    return this.productService.upsert(
      accessoryDto,
      req.business?.id,
      'accessory',
    );
  }
  @Patch(':product_id/accessories/:accessoryId/variants')
  @ApiOperation({ summary: 'Update accessory variant stock' })
  @ApiParam({ name: 'product_id', required: true })
  @ApiParam({ name: 'accessory_id', required: true })
  @ApiBody({
    type: UpdateAccessoryVariantStockDto,
  })
  async updateAccessoryVariantStock(
    @Param('product_id') product_id: Types.ObjectId,
    @Param('accessory_id') accessory_id: Types.ObjectId,
    @Body() body: UpdateAccessoryVariantStockDto,
  ) {
    return this.productService.updateAccessoryVariantStock(
      { ...body, accessory_id, product_id },
      null,
    );
  }
  @Patch(':product_id/fabrics/:fabric_id/stock')
  @ApiOperation({ summary: 'Update fabric yard length stock' })
  async updateFabricStock(
    @Param() params: FabricParamDto,
    @Body() body: UpdateFabricStockDto,
  ) {
    const { product_id, fabric_id } = params;
    return this.productService.updateFabricStock(
      new Types.ObjectId(product_id),
      new Types.ObjectId(fabric_id),
      body.new_yard_length,
      null, // optional session
    );
  }
  @Get()
  @Roles(UserType.VENDOR, 'customer', UserType.ADMIN)
  @ApiOkResponse({ type: ProductListResponseDto })
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
    description:
      'Filter by product kind (clothing, accessory, fabric), sort and pagination',
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
  async findAll(@Query() query: FindAllProductsDto) {
    const { page, size, kind, search, status, sortBy, order } = query;
    return this.productService.findAll(
      Number(page),
      Number(size),
      kind,
      search,
      status,
      sortBy,
      order,
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
      req.business?.id,
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
  @Post(':id/rate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Rate a product (1–5 stars)' })
  async rateProduct(
    @Param('id') id: string,
    @Body() dto: RateProductDto,
    @Req() req,
  ) {
    const userId = req.user.id;
    const product = await this.productService.rateProduct(
      id,
      userId,
      dto.value,
      dto.comment,
    );
    return {
      message: 'Product rated successfully',
      data: product.toJSON(),
    };
  }

  // ✅ Get Rating Summary for a Product
  @Get(':id/ratings')
  @ApiOperation({ summary: 'Get product rating summary and reviews' })
  async getProductRatings(@Param('id') id: string) {
    const ratingSummary = await this.productService.getProductRating(id);
    return {
      message: 'Product ratings fetched successfully',
      data: ratingSummary,
    };
  }
  @Roles('customer')
  @Post(':id/wishlist')
  async toggleWishlist(@Param('id') id: string, @Req() req: any) {
    const result = await this.productService.toggleWishlist(req.user.id, id);
    return result;
  }

  @Roles('customer')
  @Get('/trending/week')
  @ApiOkResponse({
    description: 'Trending products this week',
    schema: {
      example: [
        {
          id: '690f834c4d38e9188cc62f1a',
          kind: 'clothing',
          base_price: 616320,
          average_rating: 4.8,
          business: {
            _id: '69049d408ac6f362e6cf2cfa',
            business_name: 'Qlozet Fashion',
            business_logo_url: 'https://res.cloudinary.com/.../logo.png',
          },
          createdAt: '2025-11-08T17:52:12.060Z',
        },
      ],
    },
  })
  async getTrendingProductsThisWeek() {
    return this.productService.getTrendingProductsThisWeek();
  }

  @Roles(UserType.VENDOR)
  @Patch(':product_id/status')
  async updateStatus(
    @Param('product_id') productId: string,
    @Body() dto: UpdateStatusDto,
    @Req() req: any,
  ) {
    return this.productService.updateStatus(
      productId,
      req.business.id,
      dto.status,
    );
  }

  // Schedule automatic activation
  @Roles(UserType.VENDOR)
  @Patch(':product_id/schedule-activation')
  async scheduleActivation(
    @Param('product_id') productId: string,
    @Body() dto: ScheduleActivationDto,
    @Req() req: any,
  ) {
    return this.productService.scheduleActivation(
      productId,
      req.business.id,
      new Date(dto.activation_date),
    );
  }
}
