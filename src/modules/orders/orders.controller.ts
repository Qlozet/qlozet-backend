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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: 'Create a new order from cart' })
  async create(@Body() dto: CreateOrderDto, @Req() req) {
    const userId = req.user?._id;
    if (!userId) throw new NotFoundException('User not found');
    return this.orderService.createOrderFromCart(userId, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all orders for current user (paginated)' })
  async findAll(@Req() req, @Query('page') page = 1, @Query('size') size = 10) {
    const userId = req.user?._id;
    if (!userId) throw new NotFoundException('User not found');
    return this.orderService.findUserOrders(userId, page, size);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get single order by ID for current user' })
  async findOne(@Param('id') id: string, @Req() req) {
    const userId = req.user?._id;
    if (!userId) throw new NotFoundException('User not found');

    const order = await this.orderService.findUserOrderById(id, userId);
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
