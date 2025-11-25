// src/token/token.controller.ts
import {
  Controller,
  Post,
  Param,
  Body,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { TokenService } from './token.service';
import {
  EarnDto,
  SpendDto,
  PurchaseDto,
  HistoryQueryDto,
} from './dto/token.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../auth/dto/base-login.dto';

@Controller('token')
export class TokenController {
  constructor(private readonly service: TokenService) {}
  @Post('customer/purchase')
  async customerPurchase(@Body() dto: PurchaseDto, @Req() req: any) {
    return this.service.purchase(dto.amount, undefined, req.user.id);
  }

  @Roles(UserType.VENDOR)
  @Post('vendor/purchase')
  async VendorPurchase(@Body() dto: PurchaseDto, @Req() req: any) {
    return this.service.purchase(dto.amount, req.business.id);
  }
}
