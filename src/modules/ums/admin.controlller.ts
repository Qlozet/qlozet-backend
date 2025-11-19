import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { RolesService, UserService } from './services';
import { TeamService } from './services/team.service';
import { BusinessService } from '../business/business.service';
import { OrderService } from '../orders/orders.service';
import { Types } from 'mongoose';
import { FetchCustomersDto } from './dto/fetch-customer.dto';

@ApiTags('Admin')
@Controller('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class AdminController {
  constructor(
    private readonly userService: UserService,
    private readonly teamService: TeamService,
    private readonly rolesService: RolesService,
    private readonly businessService: BusinessService,
    private readonly orderService: OrderService,
  ) {}

  // ------------------------------------------------------
  // GET ALL BUSINESSES
  // ------------------------------------------------------
  @Get('businesses')
  @ApiOperation({ summary: 'Get all registered businesses' })
  @ApiResponse({
    status: 200,
    description: 'List of businesses retrieved successfully',
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
  async getAllBusinesses(
    @Query('page') page: number,
    @Query('size') size: number,
  ) {
    return this.businessService.findAllBusinesses(page, size);
  }
  @Get('businesses/:id')
  @ApiOperation({ summary: 'Get a single business by ID' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  getBusinessById(@Param('id') id: string) {
    return this.businessService.findBusinessById(id);
  }

  // ------------------------------------------------------
  // APPROVE BUSINESS
  // ------------------------------------------------------
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a business' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business approved successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  approve(@Param('id') id: string) {
    return this.businessService.approveBusiness(id);
  }

  // ------------------------------------------------------
  // VERIFY BUSINESS
  // ------------------------------------------------------
  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify a business (final verification step)' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business verified successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  verify(@Param('id') id: string) {
    return this.businessService.verifyBusiness(id);
  }

  // ------------------------------------------------------
  // REJECT BUSINESS
  // ------------------------------------------------------
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a business' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business rejected successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  reject(@Param('id') id: string) {
    return this.businessService.rejectBusiness(id);
  }

  // ------------------------------------------------------
  // SET BUSINESS BACK TO IN-REVIEW
  // ------------------------------------------------------
  @Post(':id/in-review')
  @ApiOperation({ summary: 'Set a business to in-review' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business moved to in-review status',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  setInReview(@Param('id') id: string) {
    return this.businessService.setInReview(id);
  }
  /** ---------------- Admin Dashboard ---------------- */
  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard metrics' })
  async getAdminDashboard() {
    return this.orderService.getAdminDashboardMetrics();
  }

  /** ---------------- Vendor Dashboard ---------------- */
  @Get('vendor/dashboard')
  @ApiOperation({ summary: 'Get vendor/business dashboard metrics' })
  @ApiQuery({ name: 'businessId', type: String, required: true })
  async getVendorDashboard(@Query('businessId') businessId: string) {
    return this.orderService.getVendorDashboardMetrics(
      new Types.ObjectId(businessId),
    );
  }

  @Get('vendor/orders')
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Optional order status filter',
  })
  async findVendorOrders(
    @Query('page')
    page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    return this.orderService.findVendorOrders(
      Number(page),
      Number(size),
      status,
    );
  }

  @Get('customer')
  @ApiOperation({ summary: 'Fetch customers with filters' })
  async fetchCustomers(@Query() filters: FetchCustomersDto) {
    return this.userService.fetchCustomers(filters.page, filters.size, filters);
  }
}
