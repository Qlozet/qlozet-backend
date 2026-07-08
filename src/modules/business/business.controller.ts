import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { BusinessService } from './business.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { Warehouse } from './schemas/warehouse.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { VendorRole } from '../ums/schemas/role.schema';
import { ValidatedAddressResponseDto } from '../logistics/dto/shipping.dto';
import { CreateBusinessAddressDto } from './dto/create-address.dto';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { UserType } from '../auth/dto/base-login.dto';

@ApiTags('Business')
@ApiBearerAuth('access-token')
@Controller('business')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('warehouse')
  @ApiOperation({ summary: 'Create a new warehouse' })
  @ApiResponse({ status: 201, description: 'Warehouse successfully created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async createWarehouse(
    @Body() dto: CreateWarehouseDto,
    @Req() req: any,
  ): Promise<Warehouse> {
    try {
      return await this.businessService.createWarehouse(dto, req.business?.id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('warehouse/:id/activate')
  @ApiOperation({ summary: 'Activate a warehouse (only one active at a time)' })
  @ApiResponse({ status: 200, description: 'Warehouse activated successfully' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async activateWarehouse(@Param('id') id: string, @Req() req: any) {
    try {
      const businessId = req.user.business;
      const warehouse = await this.businessService.activateWarehouse(
        id,
        businessId,
      );
      return {
        data: warehouse,
        message:
          'Warehouse activated successfully. Other warehouses have been deactivated.',
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Roles(UserType.VENDOR)
  @Get('warehouse')
  @ApiOperation({ summary: 'Get all warehouses' })
  @ApiResponse({ status: 200, description: 'List of all warehouses' })
  async findAll(@Query() query: any, @Req() req: any) {
    return this.businessService.findAllWarehouse(req.business?.id, query);
  }

  @Roles(UserType.VENDOR)
  @Get(':id/warehouse')
  @ApiOperation({ summary: 'Get a warehouse by ID' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse found' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async findOne(@Param('id') id: string): Promise<Warehouse> {
    return this.businessService.findOneWarehouse(id);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Put(':id/warehouse')
  @ApiOperation({ summary: 'Update warehouse details' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse updated successfully' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: CreateWarehouseDto,
  ): Promise<Warehouse> {
    return this.businessService.updateWarehouse(id, dto);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Delete(':id/warehouse')
  @ApiOperation({ summary: 'Delete a warehouse' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse deleted successfully' })
  async delete(@Param('id') id: string): Promise<{ message: string }> {
    return this.businessService.deleteWarehouse(id);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Patch('address')
  @ApiOperation({ summary: 'Add or update business address' })
  @ApiOkResponse({
    description: 'Business address updated successfully',
    type: ValidatedAddressResponseDto,
  })
  async updateBusinessAddress(
    @Body() dto: CreateBusinessAddressDto,
    @Req() req: any,
  ) {
    return this.businessService.updateBusinessAddress(req.business, dto);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Patch('profile')
  @ApiOperation({
    summary: 'Update general business profile fields',
    description:
      'Updates non-address fields like business_name, logo, cover image, description, NIN, BVN, etc.',
  })
  @ApiOkResponse({ description: 'Business profile updated successfully' })
  async updateBusinessProfile(
    @Body() dto: UpdateBusinessProfileDto,
    @Req() req: any,
  ) {
    return this.businessService.updateBusinessProfile(req.business.id, dto);
  }

  @Roles(UserType.VENDOR)
  @Get('earnings/upcoming')
  async getUpcomingEarnings(@Req() req: any) {
    return this.businessService.getUpcomingEarnings(req.business.id);
  }
  @Roles(UserType.VENDOR)
  @Get()
  async getBusinessProfile(@Req() req: any) {
    return this.businessService.findBusinessById(req.business?.id);
  }
  @Roles(UserType.VENDOR)
  @Get('earnings-chart')
  async getEarningChart(@Req() req: any) {
    return this.businessService.getEarningsChart(req.business?.id);
  }

  @Roles(UserType.VENDOR)
  @Get('customers')
  @ApiOperation({ summary: 'Get paginated list of vendor customers' })
  @ApiResponse({ status: 200, description: 'Paginated list of customers with stats and orders' })
  async getVendorCustomers(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orders_limit') ordersLimit?: string,
  ) {
    return this.businessService.getVendorCustomers(
      req.business?.id,
      Number(page) || 1,
      Number(limit) || 20,
      Number(ordersLimit) || 5,
    );
  }

  @Roles(UserType.VENDOR)
  @Get('customers/:id/wishlist')
  @ApiOperation({ summary: 'Get a specific customer\'s wishlist items that belong to this vendor' })
  @ApiResponse({ status: 200, description: 'List of wishlist products belonging to the vendor' })
  async getVendorCustomerWishlist(
    @Req() req: any,
    @Param('id') customerId: string,
  ) {
    return this.businessService.getVendorCustomerWishlist(req.business?.id, customerId);
  }
}
