import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Req,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiBody, ApiQuery } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { UserType } from '../ums/schemas';
import { VendorRole } from '../ums/schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';

@ApiTags('Disputes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  // ── Customer Endpoints ──

  @Roles(UserType.CUSTOMER)
  @Post()
  @ApiOperation({ summary: 'File a dispute (customer only)' })
  @ApiBody({ type: CreateDisputeDto })
  async fileDispute(@Body() dto: CreateDisputeDto, @Req() req: any) {
    const customerId = req.user?.id || req.user?._id;
    return this.disputesService.fileDispute(customerId, dto);
  }

  @Roles(UserType.CUSTOMER)
  @Get('my')
  @ApiOperation({ summary: 'Get my disputes (customer)' })
  async getMyDisputes(@Req() req: any) {
    const customerId = req.user?.id || req.user?._id;
    return this.disputesService.getCustomerDisputes(customerId);
  }

  // ── Vendor Endpoints ──

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Patch(':id/respond')
  @ApiOperation({ summary: 'Vendor responds to a dispute with counter-evidence' })
  async respondToDispute(
    @Param('id') id: string,
    @Body() body: { response: string; evidence_urls?: string[] },
    @Req() req: any,
  ) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    return this.disputesService.respondToDispute(id, businessId, body.response, body.evidence_urls);
  }

  @Roles(UserType.VENDOR)
  @Get('vendor')
  @ApiOperation({ summary: 'Get disputes for my business (vendor)' })
  async getVendorDisputes(@Req() req: any) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    return this.disputesService.getVendorDisputes(businessId);
  }

  // ── Admin Endpoints ──

  @Roles(UserType.ADMIN)
  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Admin resolves a dispute' })
  @ApiBody({ type: ResolveDisputeDto })
  async resolveDispute(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @Req() req: any,
  ) {
    const adminId = req.user?.id || req.user?._id;
    return this.disputesService.resolveDispute(id, adminId, dto);
  }

  @Roles(UserType.ADMIN)
  @Get('admin')
  @ApiOperation({ summary: 'List all disputes (admin)' })
  @ApiQuery({ name: 'status', required: false })
  async getAllDisputes(@Query('status') status?: string) {
    return this.disputesService.getAllDisputes(status);
  }
}
