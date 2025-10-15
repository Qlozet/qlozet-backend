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

@ApiTags('Business')
@ApiBearerAuth('access-token')
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new warehouse' })
  @ApiResponse({ status: 201, description: 'Warehouse successfully created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async createWarehouse(
    @Body() dto: CreateWarehouseDto,
    @Req() req: any,
  ): Promise<Warehouse> {
    try {
      return await this.businessService.create(dto, req.user.id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all warehouses' })
  @ApiResponse({ status: 200, description: 'List of all warehouses' })
  async findAll(): Promise<Warehouse[]> {
    return this.businessService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a warehouse by ID' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse found' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async findOne(@Param('id') id: string): Promise<Warehouse> {
    return this.businessService.findOne(id);
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
    return this.businessService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a warehouse' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiResponse({ status: 200, description: 'Warehouse deleted successfully' })
  async delete(@Param('id') id: string): Promise<{ message: string }> {
    return this.businessService.delete(id);
  }
}
