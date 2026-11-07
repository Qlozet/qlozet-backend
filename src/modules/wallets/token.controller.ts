// src/token/token.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import { TokenService } from './token.service';
import { PurchaseDto } from './dto/token.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { VendorRoles } from 'src/common/decorators/vendor-roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';
import { VendorRole } from '../ums/schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Public } from '../../common/decorators/public.decorator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Tokens')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('token')
export class TokenController {
  constructor(private readonly service: TokenService) {}

  @Roles(UserType.VENDOR, UserType.CUSTOMER)
  @Get('balance')
  @ApiOperation({ summary: 'Get active token balance' })
  async getBalance(@Req() req: any) {
    const business = req.business?.id;
    const customer = req.user?.id;
    const tokens = await this.service.balance(business, customer);
    return { tokens };
  }

  // Public: the shop shows the packs before sign-in too.
  @Public()
  @Get('packs')
  @ApiOperation({ summary: 'Token packs on sale (admin-set), with how many AI designs each covers' })
  async packs() {
    return this.service.packs();
  }

  @Post('customer/purchase')
  @ApiOperation({ summary: 'Buy a token pack (pack_id) for a customer, from the wallet' })
  async customerPurchase(@Body() dto: PurchaseDto, @Req() req: any) {
    return this.service.purchase(dto.amount, undefined, req.user.id, dto.pack_id);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('vendor/purchase')
  @ApiOperation({ summary: 'Purchase tokens for vendor business' })
  async VendorPurchase(@Body() dto: PurchaseDto, @Req() req: any) {
    return this.service.purchase(dto.amount, req.business.id, undefined, dto.pack_id);
  }
}
