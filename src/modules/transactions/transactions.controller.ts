import {
  Controller,
  Get,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { TransactionService } from './transactions.service';
import { VendorRole } from '../ums/schemas';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Roles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Get('business')
  @ApiOperation({ summary: 'Get paginated transactions by business ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated transactions list' })
  @ApiResponse({ status: 404, description: 'No transactions found' })
  async getByBusiness(
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Req() req: any,
  ) {
    try {
      return await this.transactionService.findByBusiness(
        req.business._id,
        +page,
        +size,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
}
