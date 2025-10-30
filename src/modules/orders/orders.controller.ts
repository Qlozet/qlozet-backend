import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /**
   * 🧾 Create a new order
   * - Direct checkout or from cart
   */
  @Roles('customer')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Create a new order (direct or from cart)' })
  async create(@Body() dto: CreateOrderDto, @Req() req) {
    const customer = req.user?.id;
    const business = req.business?.id;
    return this.orderService.createOrder(dto, business, customer);
  }

  // In your controller
  @Get('customer')
  async findCustomerOrders(
    @Req() req,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    const userId = req.user?._id || req.user?.id;
    if (!userId) throw new NotFoundException('User not found');

    return this.orderService.findCustomerOrdersWithFilters(
      userId,
      Number(page),
      Number(size),
      status,
    );
  }

  @Get('vendor')
  async findVendorOrders(
    @Req() req,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    const userId = req.user?._id || req.user?.id;
    return this.orderService.findVendorOrders(
      userId,
      Number(page),
      Number(size),
      status,
    );
  }
}
