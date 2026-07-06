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
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
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
  @ApiOperation({ summary: 'Get all discounts for your business' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async findAll(@Query() query: any, @Req() req: any) {
    return this.discountService.findAll(req.business?.id, query);
  }

  /**
   * Get all active discounts
   */
  @Get('active')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get all currently active discounts' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async findActive(@Query() query: any, @Req() req: any) {
    return this.discountService.findActive(req.business?.id, query);
  }

  /**
   * Get a single discount by ID
   */
  @Get(':id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get a discount by ID' })
  @ApiParam({ name: 'id', description: 'Discount ID' })
  async findById(@Param('id') id: string, @Req() req: any) {
    return this.discountService.findById(id, req.business?.id);
  }

  /**
   * Update a discount
   */
  @Patch(':id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Update a discount' })
  @ApiParam({ name: 'id', description: 'Discount ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateDiscountDto>,
    @Req() req: any,
  ) {
    return this.discountService.update(id, dto, req.business?.id);
  }

  /**
   * Delete a discount
   */
  @Delete(':id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Delete a discount and remove it from all products' })
  @ApiParam({ name: 'id', description: 'Discount ID' })
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.discountService.delete(id, req.business?.id);
  }

  /**
   * Manually apply a specific discount
   */
  @Post('apply/:id')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Manually trigger discount application to matching products' })
  @ApiParam({ name: 'id', description: 'Discount ID' })
  async applyDiscount(@Param('id') id: string) {
    const count = await this.discountService.applyDiscountToMatchingProducts(id);
    return { message: `Discount applied to ${count} products` };
  }

  /**
   * Get discounted products for a specific vendor
   */
  @Get('vendor/products')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Get discounted products for your business' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  @ApiQuery({ name: 'kind', required: false, enum: ['clothing', 'fabric', 'accessory'] })
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
  @ApiOperation({ summary: 'Get all products currently under discount' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async getDiscountedProducts(@Query() query: any, @Req() req: any) {
    return this.discountService.getDiscountedProducts(req.business?.id, query);
  }
}
