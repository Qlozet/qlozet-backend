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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrderService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /**
   * 🧾 Create a new order
   * - Direct checkout or from cart
   */
  @Roles('customer')
  @Roles(UserType.CUSTOMER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Create a new order (direct or from cart)' })
  async create(@Body() dto: CreateOrderDto, @Req() req) {
    const customer = req.user;
    return this.orderService.createOrder(dto, customer);
  }

  // In your controller
  @Get('customer')
  @Roles(UserType.CUSTOMER)
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Optional order status filter',
  })
  async findCustomerOrders(
    @Req() req,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new NotFoundException('User not found');

    return this.orderService.findCustomerOrdersWithFilters(
      userId,
      Number(page),
      Number(size),
      status,
    );
  }

  @Roles(UserType.VENDOR)
  @Get('vendor')
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Optional order status filter',
  })
  async findVendorOrders(
    @Req() req,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    return this.orderService.findVendorOrders(
      Number(page),
      Number(size),
      status,
      req.business?._id,
    );
  }
  // @Roles(UserType.VENDOR)
  // @Post('confirm/:reference')
  // @ApiOperation({ summary: 'Confirm an order and create shipment' })
  // async confirmOrder(@Param('reference') reference: string, @Req() req) {
  //   const business = req.business;
  //   return this.orderService.confirmOrder(reference, business);
  // }
  @Roles(UserType.VENDOR)
  @Post('reject/:reference')
  @ApiOperation({ summary: 'Reject an order and refund customer' })
  async rejectOrder(@Param('reference') reference: string) {
    return this.orderService.cancelOrder(reference);
  }
}
