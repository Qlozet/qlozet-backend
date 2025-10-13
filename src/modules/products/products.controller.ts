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
  @ApiBody({
    type: CreateClothingDto,
    schema: {
      example: {
        kind: 'clothing',
        base_price: 15000,
        seo: {
          title: 'Premium Hausa Cap',
          keywords: ['cap', 'Hausa'],
        },
        metafields: {
          region: 'Maiduguri',
          material: 'cotton',
        },
        images: [
          {
            public_id: 'qoobea_img_12345',
            url: 'https://res.cloudinary.com/demo/image/upload/qoobea_img_12345.jpg',
            width: 800,
            height: 600,
          },
        ],
        clothing: {
          name: 'Classic Hausa Cap',
          description: 'Handmade cap from Maiduguri',
          turnaround_days: 7,
          is_customizable: true,
          taxonomy: {
            product_type: 'clothing',
            category: 'caps',
            sub_category: 'traditional',
            tags: ['Hausa', 'premium'],
            audience: 'men',
          },
          status: 'active',
          base_price: 15000,
          images: [
            {
              public_id: 'cap_img_001',
              url: 'https://res.cloudinary.com/demo/image/upload/cap_img_001.jpg',
              width: 800,
              height: 600,
            },
          ],
          styles: [
            {
              name: 'Classic Cap Style',
              style_code: 'CCS-001',
              audience: 'men',
              categories: ['caps', 'traditional'],
              tags: ['Hausa', 'handmade'],
              taxonomy: {
                product_type: 'shirt',
                category: 'formal',
                sub_category: 'dress-shirts',
                tags: ['dress', 'formal'],
                audience: 'men',
              },
              images: [
                {
                  public_id: 'cap_style_img_001',
                  url: 'https://res.cloudinary.com/demo/image/upload/cap_style_img_001.jpg',
                },
              ],
              price: 15000,
              min_width_cm: 10,
              notes: 'Handmade in Maiduguri',
              fields: {
                embroidery: {
                  label: 'Embroidery Style',
                  options: [
                    { name: 'Simple', price_effect: 0 },
                    { name: 'Premium', price_effect: 2000 },
                  ],
                },
              },
              variants: [
                {
                  colors: [{ hex: '#FF0000' }],
                  size: 'M',
                  images: [
                    {
                      public_id: 'cap_variant_001',
                      url: 'https://res.cloudinary.com/demo/image/upload/cap_variant_001.jpg',
                    },
                  ],
                  stock: 10,
                  price: 15500,
                  sku: 'CAP-M-RED',
                  measurement_range: { head_circumference_cm: 58 },
                  attributes: { material: 'cotton' },
                },
              ],
            },
          ],
          color_variants: [
            {
              colors: [{ hex: '#FF0000' }],
              size: 'M',
              images: [
                {
                  public_id: 'cap_color_001',
                  url: 'https://res.cloudinary.com/demo/image/upload/cap_color_001.jpg',
                },
              ],
              stock: 10,
              price: 15500,
              sku: 'CAP-M-RED',
            },
          ],
          fabric_variants: [
            {
              name: 'Premium Cotton',
              product_type: 'cotton',
              colors: ['red', 'blue'],
              pattern: 'striped',
              yard_length: 2,
              width: 60,
              min_cut: 1,
              price_per_yard: 2500,
              images: [
                {
                  public_id: 'fabric_img_001',
                  url: 'https://res.cloudinary.com/demo/image/upload/fabric_img_001.jpg',
                },
              ],
            },
          ],
        },
      },
    },
  })
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
  @ApiBody({
    type: CreateFabricDto,
    schema: {
      example: {
        kind: 'fabric',
        base_price: 8000,
        seo: {
          title: 'Premium Cotton Fabric',
          keywords: ['cotton', 'fabric', 'quality'],
        },
        metafields: {
          region: 'Maiduguri',
          material: 'cotton',
        },
        images: [
          {
            public_id: 'fabric_img_001',
            url: 'https://res.cloudinary.com/demo/image/upload/fabric_img_001.jpg',
            width: 800,
            height: 600,
          },
        ],
        fabric: {
          name: 'Premium Cotton',
          description:
            'Soft and breathable cotton fabric, perfect for summer wear.',
          product_type: 'cotton',
          colors: ['#FFFFFF', '#000000', '#FF5733'],
          pattern: 'striped',
          yard_length: 2,
          width: 60,
          min_cut: 1,
          price_per_yard: 2500,
          images: [
            {
              public_id: 'fabric_img_001',
              url: 'https://res.cloudinary.com/demo/image/upload/fabric_img_001.jpg',
            },
          ],
        },
      },
    },
  })
  async createFabric(@Body() fabricDto: CreateFabricDto, @Req() req: any) {
    return this.productService.create(fabricDto, req.user.id, 'fabric');
  }

  // ---------------- ACCESSORY ----------------
  @Post('accessory')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new accessory product' })
  @ApiResponse({ status: 201, description: 'Accessory product created' })
  @ApiBody({
    type: CreateAccessoryDto,
    schema: {
      example: {
        kind: 'accessory',
        base_price: 5000,
        seo: {
          title: 'Premium Leather Wallet',
          keywords: ['wallet', 'leather', 'accessory'],
        },
        metafields: {
          region: 'Maiduguri',
          material: 'leather',
        },
        accessory: {
          name: 'Premium Leather Wallet',
          description: 'Handmade wallet with high-quality leather',
          base_price: 5000,
          taxonomy: {
            product_type: 'accessory',
            category: 'wallets',
            sub_category: 'men',
            tags: ['leather', 'premium', 'handmade'],
            audience: 'men',
          },
          variants: [
            {
              colors: [{ hex: '#000000' }, { hex: '#8B4513' }],
              size: 'Standard',
              images: [
                {
                  public_id: 'wallet_variant_001',
                  url: 'https://res.cloudinary.com/demo/image/upload/wallet_variant_001.jpg',
                },
              ],
              stock: 50,
              price: 5000,
              sku: 'WALLET-BLK-STD',
              measurement_range: { length_cm: 12, width_cm: 9 },
              attributes: { material: 'leather', finish: 'matte' },
            },
          ],
        },
      },
    },
  })
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
