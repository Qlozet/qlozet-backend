import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { BusinessService } from './business.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { Warehouse } from './schemas/warehouse.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRole } from '../ums/schemas';

@ApiTags('Business')
@ApiBearerAuth('access-token')
@Controller('business')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Roles(VendorRole.OWNER)
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
      return await this.businessService.createWarehouse(dto, req.user.id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
  @Roles(VendorRole.OWNER)
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

  @Get()
  @ApiOperation({ summary: 'Get all warehouses' })
  @ApiResponse({ status: 200, description: 'List of all warehouses' })
  async findAll(): Promise<Warehouse[]> {
    return this.businessService.findAllWarehouse();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a warehouse by ID' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse found' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async findOne(@Param('id') id: string): Promise<Warehouse> {
    return this.businessService.findOneWarehouse(id);
  }

  @Put(':id')
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

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a warehouse' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse deleted successfully' })
  async delete(@Param('id') id: string): Promise<{ message: string }> {
    return this.businessService.deleteWarehouse(id);
  }
}
