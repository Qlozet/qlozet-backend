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
  BadRequestException,
  UseGuards,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OrderService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  CheckoutPreviewDto,
  CheckoutPreviewResponseDto,
} from './dto/checkout-preview.dto';
import { FulfillOrderDto } from './dto/fulfill-order.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { UserType } from '../ums/schemas';
import { VendorRole } from '../ums/schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { OrderStatus } from './schemas/orders.schema';

const VALID_STATUSES = Object.values(OrderStatus);

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
  @Roles(UserType.CUSTOMER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Create a new order (direct or from cart)' })
  async create(@Body() dto: CreateOrderDto, @Req() req) {
    const customer = req.user;
    return this.orderService.createOrder(dto, customer);
  }

  /**
   * 📦 Get shipping rates per vendor before checkout
   */
  @Roles(UserType.CUSTOMER)
  @Post('checkout-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get shipping rates per vendor for cart items',
    description:
      'Splits cart by vendor, fetches Shipbubble rates for each. Returns courier options for customer to select.',
  })
  @ApiBody({ type: CheckoutPreviewDto })
  @ApiResponse({
    status: 200,
    description: 'Shipping rates per vendor',
    type: CheckoutPreviewResponseDto,
  })
  @ApiResponse({ status: 400, description: 'No validated address or empty cart' })
  async checkoutPreview(@Req() req, @Body() dto: CheckoutPreviewDto) {
    return this.orderService.checkoutPreview(req.user, dto);
  }

  // In your controller
  @Get('customer')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Get paginated orders for the logged-in customer' })
  @ApiResponse({ status: 200, description: 'Paginated list of customer orders' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: OrderStatus,
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

    if (status && !VALID_STATUSES.includes(status as OrderStatus)) {
      throw new BadRequestException(
        `Invalid status "${status}". Valid statuses: ${VALID_STATUSES.join(', ')}`,
      );
    }

    return this.orderService.findCustomerOrdersWithFilters(
      userId,
      Number(page),
      Number(size),
      status,
    );
  }

  @Roles(UserType.VENDOR)
  @Get('vendor')
  @ApiOperation({ summary: 'Get paginated orders for the logged-in vendor' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of orders containing items from this vendor',
    schema: {
      example: {
        data: [
          {
            _id: '60d5ecb8b392...',
            reference: 'ORD-123456',
            customer: {
              _id: '60d5ecb8b392...',
              email: 'customer@example.com'
            },
            status: 'pending',
            total: 15000,
            subtotal: 13000,
            shipping_fee: 2000,
            items: [
              {
                product_id: '60d5ecb8b392...',
                product_name: 'Ankara Dress',
                business: '60d5ecb8b392...',
                selections: {
                  color_variant_selection: [],
                  style_selection: [],
                  fabric_selection: [],
                  accessory_selection: []
                },
                total_price: 13000
              }
            ],
            createdAt: '2026-01-01T10:00:00.000Z',
            updatedAt: '2026-01-01T10:00:00.000Z'
          }
        ],
        total_items: 50,
        total_pages: 5,
        current_page: 1,
        has_next_page: true,
        has_previous_page: false,
        page_size: 10
      }
    }
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: OrderStatus,
    description: 'Optional order status filter',
  })
  async findVendorOrders(
    @Req() req,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    if (status && status !== 'all' && !VALID_STATUSES.includes(status as OrderStatus)) {
      throw new BadRequestException(
        `Invalid status "${status}". Valid statuses: all, ${VALID_STATUSES.join(', ')}`,
      );
    }

    return this.orderService.findVendorOrders(
      Number(page),
      Number(size),
      status,
      req.business?._id,
    );
  }

  /**
   * 🚚 Vendor fulfills their portion of the order — creates Shipbubble label
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS, VendorRole.CUSTOMER_SUPPORT)
  @Post(':reference/fulfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vendor fulfills their portion — creates Shipbubble shipping label',
    description:
      'Creates a Shipbubble label for this vendor\'s items. Re-fetches rates if token is stale (>25min).',
  })
  @ApiParam({ name: 'reference', description: 'Order reference (e.g. ORD-XXXX)' })
  @ApiBody({ type: FulfillOrderDto })
  @ApiResponse({
    status: 200,
    description: 'Shipment label created successfully',
  })
  @ApiResponse({ status: 400, description: 'Payment not completed or shipment already fulfilled' })
  async fulfillOrder(
    @Param('reference') reference: string,
    @Body() dto: FulfillOrderDto,
    @Req() req,
  ) {
    return this.orderService.fulfillVendorShipment(
      reference,
      req.business,
      dto,
    );
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Patch('cancel/:reference')
  @ApiOperation({ summary: 'Cancel an order and refund customer' })
  async rejectOrder(@Param('reference') reference: string) {
    return this.orderService.cancelOrder(reference);
  }

  @Roles(UserType.VENDOR)
  @Get('chart')
  @ApiOperation({ summary: 'Get chart data' })
  async getOrderChartData(@Req() req: any) {
    return this.orderService.getBusinessChart(req.business?.id);
  }
}

