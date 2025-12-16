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
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { Discount } from './schemas/discount.schema';
import { DiscountService } from './discount.service';
import { CreateDiscountDto } from './dto/discount.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
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
  @Roles(UserType.VENDOR)
  async create(
    @Body() dto: CreateDiscountDto,
    @Req() req: any,
  ): Promise<Discount> {
    return this.discountService.create(dto, req.business?.id);
  }

  /**
   * Get all discounts
   */
  @Roles(UserType.VENDOR)
  @Get()
  @ApiOperation({ summary: 'Get all discounts' })
  @ApiResponse({
    status: 200,
    description: 'List of all discounts',
    type: [Discount],
  })
  async findAll(@Query() query: any, @Req() req: any) {
    console.log(req.business?.id, 'req.business?.id');
    return this.discountService.findAll(req.business?.id, query);
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
  async findActive(@Query() query: any, @Req() req: any) {
    return this.discountService.findActive(req.business?.id, query);
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
  async getDiscountedProductsByVendor(@Query() query: any, @Req() req: any) {
    return this.discountService.getDiscountedProductsByVendor(
      req.business?.id,
      query,
    );
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
  async getDiscountedProducts(@Query() query: any, @Req() req: any) {
    return this.discountService.getDiscountedProducts(req.business?.id, query);
  }
}
