import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { UserType } from '../ums/schemas';
import { VendorRole } from '../ums/schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';

@ApiTags('Returns')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  // ── Customer Endpoints ──

  @Roles(UserType.CUSTOMER)
  @Post()
  @ApiOperation({ summary: 'Request a return (customer)' })
  @ApiBody({ type: CreateReturnDto })
  async requestReturn(@Body() dto: CreateReturnDto, @Req() req: any) {
    const customerId = req.user?.id || req.user?._id;
    return this.returnsService.requestReturn(customerId, dto);
  }

  @Roles(UserType.CUSTOMER)
  @Get('my')
  @ApiOperation({ summary: 'Get my returns (customer)' })
  async getMyReturns(@Req() req: any) {
    const customerId = req.user?.id || req.user?._id;
    return this.returnsService.getCustomerReturns(customerId);
  }

  // ── Vendor Endpoints ──

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a return request (vendor)' })
  async approveReturn(@Param('id') id: string, @Req() req: any) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    return this.returnsService.approveReturn(id, businessId);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a return request (vendor)' })
  async rejectReturn(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    return this.returnsService.rejectReturn(id, businessId, body.reason);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Patch(':id/received')
  @ApiOperation({ summary: 'Mark return items as received + process refund (vendor)' })
  async markReceived(@Param('id') id: string, @Req() req: any) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    return this.returnsService.markReceived(id, businessId);
  }

  @Roles(UserType.VENDOR)
  @Get('vendor')
  @ApiOperation({ summary: 'Get returns for my business (vendor)' })
  async getVendorReturns(@Req() req: any) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    return this.returnsService.getVendorReturns(businessId);
  }
}
