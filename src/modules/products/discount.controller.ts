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
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { Discount } from './schemas/discount.schema';
import { DiscountService } from './discount.service';
import { CreateDiscountDto } from './dto/discount.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { UserType } from '../auth/dto/base-login.dto';
import { Product } from '../products/schemas/product.schema';

@ApiTags('Discounts')
@ApiBearerAuth('access-token')
@Controller('discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class DiscountController {
  constructor(private readonly discountService: DiscountService) {}

  /**
   * Create a new discount
   */
  @Post()
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new discount' })
  @ApiBody({ type: CreateDiscountDto })
  @ApiResponse({
    status: 201,
    description: 'Discount created successfully',
    type: Discount,
  })
  async create(
    @Body() dto: CreateDiscountDto,
    @Req() req: any,
  ): Promise<Discount> {
    return this.discountService.create(dto, req.user.id);
  }

  /**
   * Get all discounts
   */
  @Get()
  @ApiOperation({ summary: 'Get all discounts' })
  @ApiResponse({
    status: 200,
    description: 'List of all discounts',
    type: [Discount],
  })
  async findAll(): Promise<Discount[]> {
    return this.discountService.findAll();
  }

  /**
   * Get all active discounts
   */
  @Get('active')
  @ApiOperation({ summary: 'Get all active discounts' })
  @ApiResponse({
    status: 200,
    description: 'List of active discounts',
    type: [Discount],
  })
  async findActive(): Promise<Discount[]> {
    return this.discountService.findActive();
  }

  /**
   * Apply a specific discount manually
   */
  @Get('apply/:id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Manually apply discount to matching products' })
  @ApiResponse({
    status: 200,
    description: 'Products updated with discount',
    type: [Product],
  })
  async applyDiscount(@Param('id') id: string): Promise<Product[]> {
    return this.discountService.applyDiscountToMatchingProducts(id);
  }

  @Get('vendor/products')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get discounted products for a specific vendor' })
  @ApiResponse({
    status: 200,
    description: 'List of discounted products for the vendor',
    type: [Product],
  })
  async getDiscountedProductsByVendor(@Req() req: any): Promise<Product[]> {
    return this.discountService.getDiscountedProductsByVendor(req.user.id);
  }

  /**
   * Get all discounted products
   */
  @Get('discounted-products')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get all discounted products' })
  @ApiResponse({
    status: 200,
    description: 'List of products currently under discount',
    type: [Product],
  })
  async getDiscountedProducts(): Promise<Product[]> {
    return this.discountService.getDiscountedProducts();
  }
}
