// product.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UsePipes,
  ValidationPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { CreateStyleDto } from './dto/style.dto';
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

  @Post()
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new product' })
  @ApiBody({ type: CreateProductDto })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  async createProduct(
    @Body() createProductDto: CreateProductDto,
    @Req() req: any,
  ) {
    const vendor = req.user.id;
    return this.productService.createProduct(createProductDto, vendor);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products with filtering and pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'kind',
    required: false,
    enum: ['clothing', 'fabric', 'accessory'],
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'draft', 'archived'],
  })
  @ApiQuery({ name: 'vendor', required: false })
  async getProducts(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('vendor') vendor?: string,
  ) {
    return this.productService.getProducts({
      page,
      limit,
      kind,
      status,
      vendor,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async getProduct(@Param('id') id: string) {
    return this.productService.getProductById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update product' })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  async updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productService.updateProduct(id, updateProductDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete product (soft delete)' })
  async deleteProduct(@Param('id') id: string) {
    return this.productService.deleteProduct(id);
  }

  @Put(':id/inventory')
  @ApiOperation({ summary: 'Update product inventory' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variantIndex: { type: 'number' },
              stock: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async updateInventory(
    @Param('id') id: string,
    @Body('variants')
    variantUpdates: Array<{ variantIndex: number; stock: number }>,
  ) {
    return this.productService.updateInventory(id, variantUpdates);
  }

  // Style endpoints
  @Post('styles')
  @ApiOperation({ summary: 'Create a new style' })
  @ApiBody({ type: CreateStyleDto })
  async createStyle(@Body() createStyleDto: CreateStyleDto) {
    return this.productService.createStyle(createStyleDto);
  }

  @Get('styles/all')
  @ApiOperation({ summary: 'Get all styles' })
  async getAllStyles() {
    return this.productService.getAllStyles();
  }
}
