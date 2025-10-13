import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
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
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { UserType } from '../auth/dto/base-login.dto';

@ApiTags('Discounts')
@ApiBearerAuth('access-token')
@Controller('discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class DiscountController {
  constructor(private readonly discountService: DiscountService) {}

  @Post()
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Create a new discount' })
  @ApiBody({ type: CreateDiscountDto })
  @ApiResponse({
    status: 201,
    description: 'Discount created successfully',
    type: Discount,
  })
  async create(@Body() dto: CreateDiscountDto): Promise<Discount> {
    return this.discountService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all discounts' })
  @ApiResponse({
    status: 200,
    description: 'List of all discounts',
    type: [Discount],
  })
  async findAll(): Promise<Discount[]> {
    return this.discountService.findAll();
  }

  @Get('active')
  @ApiOperation({ summary: 'Get all active discounts' })
  @ApiResponse({
    status: 200,
    description: 'List of active discounts',
    type: [Discount],
  })
  async findActive(): Promise<Discount[]> {
    return this.discountService.findActive();
  }
}
